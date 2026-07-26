import type {
  Feature,
  FeatureCollection,
  MultiPolygon,
  Polygon,
  Position,
} from "geojson";

export type Coordinate = [number, number];

export interface AddressSuggestion {
  label: string;
  address: string;
  center: Coordinate;
}

export interface IsochroneProperties {
  minutes: number;
}

export type IsochroneCollection = FeatureCollection<
  Polygon | MultiPolygon,
  IsochroneProperties
>;

export interface CommuteServiceDependencies {
  fetch?: typeof fetch;
  orsApiKey?: string;
  nominatimBaseUrl?: string;
  orsBaseUrl?: string;
  proximity?: Coordinate;
}

const NOMINATIM_BASE_URL = "https://nominatim.openstreetmap.org";
const ORS_BASE_URL = "https://api.openrouteservice.org";
const USER_AGENT = "places-heatmap/0.1 (+local-app)";
const requestCache = new Map<
  string,
  { expiresAt: number; value: Promise<unknown> }
>();

function serverEnvironmentValue(name: "ORS_API_KEY") {
  return process.env[name] || import.meta.env[name];
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function validCoordinate(value: unknown): value is Coordinate {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    typeof value[0] === "number" &&
    Number.isFinite(value[0]) &&
    value[0] >= -180 &&
    value[0] <= 180 &&
    typeof value[1] === "number" &&
    Number.isFinite(value[1]) &&
    value[1] >= -90 &&
    value[1] <= 90
  );
}

function withMemoryCache<T>(
  key: string,
  ttlMilliseconds: number,
  load: () => Promise<T>,
): Promise<T> {
  const now = Date.now();
  const cached = requestCache.get(key);
  if (cached && cached.expiresAt > now) return cached.value as Promise<T>;

  const value = load().catch((error) => {
    requestCache.delete(key);
    throw error;
  });
  requestCache.set(key, { expiresAt: now + ttlMilliseconds, value });
  return value;
}

async function fetchJson(
  url: URL | string,
  init: RequestInit,
  fetchImplementation: typeof fetch,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetchImplementation(url, {
      ...init,
      signal: controller.signal,
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(
        `request failed with status ${response.status}${
          body ? `: ${body.slice(0, 200)}` : ""
        }`,
      );
    }
    return (await response.json()) as unknown;
  } finally {
    clearTimeout(timeout);
  }
}

function dedupeSuggestions(suggestions: AddressSuggestion[]) {
  const seen = new Set<string>();
  return suggestions.filter(({ address, center }) => {
    const key = `${address.toLowerCase()}|${center[0].toFixed(5)}|${center[1].toFixed(5)}`;
    if (!address || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function distanceSquared(
  [longitude, latitude]: Coordinate,
  [otherLongitude, otherLatitude]: Coordinate,
) {
  const latitudeScale = Math.cos(
    (((latitude + otherLatitude) / 2) * Math.PI) / 180,
  );
  const longitudeDelta =
    ((((longitude - otherLongitude) % 360) + 540) % 360) - 180;
  const latitudeDelta = latitude - otherLatitude;
  return (
    (longitudeDelta * latitudeScale) ** 2 + latitudeDelta * latitudeDelta
  );
}

function prioritizeNearbySuggestions(
  suggestions: AddressSuggestion[],
  proximity: Coordinate | undefined,
) {
  if (!proximity) return suggestions;
  return suggestions
    .map((suggestion, index) => ({ suggestion, index }))
    .sort(
      (first, second) =>
        distanceSquared(first.suggestion.center, proximity) -
          distanceSquared(second.suggestion.center, proximity) ||
        first.index - second.index,
    )
    .map(({ suggestion }) => suggestion);
}

export function normalizeNominatimSuggestions(
  payload: unknown,
): AddressSuggestion[] {
  if (!Array.isArray(payload)) {
    throw new Error("Address lookup returned malformed data.");
  }

  return dedupeSuggestions(
    payload.flatMap((item): AddressSuggestion[] => {
      if (!item || typeof item !== "object") return [];
      const candidate = item as {
        display_name?: unknown;
        lat?: unknown;
        lon?: unknown;
      };
      const center: Coordinate = [Number(candidate.lon), Number(candidate.lat)];
      const address =
        typeof candidate.display_name === "string"
          ? candidate.display_name.trim()
          : "";
      if (!address || !validCoordinate(center)) return [];
      return [{ label: address, address, center }];
    }),
  );
}

export function normalizeOrsSuggestions(payload: unknown): AddressSuggestion[] {
  const features =
    payload && typeof payload === "object"
      ? (payload as { features?: unknown }).features
      : undefined;
  if (!Array.isArray(features)) {
    throw new Error("Address lookup returned malformed data.");
  }

  return dedupeSuggestions(
    features.flatMap((feature): AddressSuggestion[] => {
      if (!feature || typeof feature !== "object") return [];
      const candidate = feature as {
        geometry?: { coordinates?: unknown };
        properties?: { label?: unknown; name?: unknown };
      };
      const center = candidate.geometry?.coordinates;
      const label =
        typeof candidate.properties?.label === "string"
          ? candidate.properties.label.trim()
          : typeof candidate.properties?.name === "string"
            ? candidate.properties.name.trim()
            : "";
      if (!label || !validCoordinate(center)) return [];
      return [{ label, address: label, center }];
    }),
  );
}

async function requestOrsSuggestions(
  query: string,
  apiKey: string,
  dependencies: CommuteServiceDependencies,
) {
  const url = new URL(
    "/geocode/search",
    dependencies.orsBaseUrl ?? ORS_BASE_URL,
  );
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("text", query);
  url.searchParams.set("size", "6");
  if (dependencies.proximity) {
    url.searchParams.set(
      "focus.point.lon",
      String(dependencies.proximity[0]),
    );
    url.searchParams.set(
      "focus.point.lat",
      String(dependencies.proximity[1]),
    );
  }
  const payload = await fetchJson(
    url,
    { headers: { Accept: "application/json" } },
    dependencies.fetch ?? fetch,
  );
  return normalizeOrsSuggestions(payload);
}

async function requestNominatimSuggestions(
  query: string,
  dependencies: CommuteServiceDependencies,
) {
  const url = new URL(
    "/search",
    dependencies.nominatimBaseUrl ?? NOMINATIM_BASE_URL,
  );
  url.searchParams.set("q", query);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "6");
  url.searchParams.set("addressdetails", "1");
  if (dependencies.proximity) {
    const [longitude, latitude] = dependencies.proximity;
    const west = Math.max(-180, longitude - 1);
    const east = Math.min(180, longitude + 1);
    const north = Math.min(90, latitude + 1);
    const south = Math.max(-90, latitude - 1);
    url.searchParams.set("viewbox", `${west},${north},${east},${south}`);
  }
  const payload = await fetchJson(
    url,
    {
      headers: {
        Accept: "application/json",
        "Accept-Language": "en",
        "User-Agent": USER_AGENT,
      },
    },
    dependencies.fetch ?? fetch,
  );
  return normalizeNominatimSuggestions(payload);
}

export async function lookupAddressSuggestions(
  query: string,
  dependencies: CommuteServiceDependencies = {},
): Promise<AddressSuggestion[]> {
  const normalized = query.replace(/\s+/g, " ").trim();
  if (normalized.length < 3) return [];

  return withMemoryCache(
    `commute-address:${normalized.toLowerCase()}:${
      dependencies.proximity
        ? dependencies.proximity.map((coordinate) => coordinate.toFixed(3)).join(",")
        : "global"
    }`,
    14 * 24 * 60 * 60 * 1_000,
    async () => {
      const apiKey = dependencies.orsApiKey ?? serverEnvironmentValue("ORS_API_KEY");
      if (apiKey) {
        try {
          const suggestions = await requestOrsSuggestions(
            normalized,
            apiKey,
            dependencies,
          );
          if (suggestions.length > 0) {
            return prioritizeNearbySuggestions(
              suggestions,
              dependencies.proximity,
            );
          }
        } catch {
          // Nominatim is the public fallback for address lookup only.
        }
      }
      return prioritizeNearbySuggestions(
        await requestNominatimSuggestions(normalized, dependencies),
        dependencies.proximity,
      );
    },
  );
}

function validPosition(position: unknown): position is Position {
  return (
    Array.isArray(position) &&
    position.length >= 2 &&
    typeof position[0] === "number" &&
    Number.isFinite(position[0]) &&
    typeof position[1] === "number" &&
    Number.isFinite(position[1])
  );
}

function validLineString(value: unknown): value is Position[] {
  return (
    Array.isArray(value) &&
    value.length >= 4 &&
    value.every(validPosition)
  );
}

function validPolygonCoordinates(value: unknown): value is Position[][] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(validLineString)
  );
}

function validMultiPolygonCoordinates(value: unknown): value is Position[][][] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(validPolygonCoordinates)
  );
}

export function normalizeIsochrones(
  payload: unknown,
  requestedMinutes: number[],
): IsochroneCollection {
  const features =
    payload && typeof payload === "object"
      ? (payload as { features?: unknown }).features
      : undefined;
  if (!Array.isArray(features) || features.length === 0) {
    throw new Error("Isochrone response was missing polygon data.");
  }

  const normalized = features.flatMap(
    (rawFeature, index): Array<
      Feature<Polygon | MultiPolygon, IsochroneProperties>
    > => {
      if (!rawFeature || typeof rawFeature !== "object") return [];
      const feature = rawFeature as {
        geometry?: { type?: unknown; coordinates?: unknown };
        properties?: { value?: unknown };
      };
      const type = feature.geometry?.type;
      const coordinates = feature.geometry?.coordinates;
      const valueSeconds = Number(feature.properties?.value);
      const fallbackMinutes = requestedMinutes[index];
      const minutes = Number.isFinite(valueSeconds)
        ? valueSeconds / 60
        : fallbackMinutes;
      if (!Number.isFinite(minutes)) return [];
      if (
        type === "Polygon" &&
        validPolygonCoordinates(coordinates)
      ) {
        return [
          {
            type: "Feature",
            geometry: { type, coordinates },
            properties: { minutes },
          },
        ];
      }
      if (
        type === "MultiPolygon" &&
        validMultiPolygonCoordinates(coordinates)
      ) {
        return [
          {
            type: "Feature",
            geometry: { type, coordinates },
            properties: { minutes },
          },
        ];
      }
      return [];
    },
  );

  if (normalized.length === 0) {
    throw new Error("Isochrone response contained no valid polygons.");
  }
  return {
    type: "FeatureCollection",
    features: normalized.sort(
      (first, second) =>
        first.properties.minutes - second.properties.minutes,
    ),
  };
}

export async function getDrivingIsochrones(
  center: Coordinate,
  minutes: number[],
  dependencies: CommuteServiceDependencies = {},
): Promise<IsochroneCollection> {
  if (!validCoordinate(center)) {
    throw new Error("A valid address coordinate is required.");
  }
  const normalizedMinutes = Array.from(
    new Set(minutes.filter(Number.isFinite).map((value) => Math.round(value))),
  ).sort((first, second) => first - second);
  if (
    normalizedMinutes.length === 0 ||
    normalizedMinutes.length > 10 ||
    normalizedMinutes.some((value) => value < 5 || value > 60)
  ) {
    throw new Error("Commute times must contain 1–10 values from 5 to 60 minutes.");
  }

  const apiKey = dependencies.orsApiKey ?? serverEnvironmentValue("ORS_API_KEY");
  if (!apiKey) {
    throw new Error(
      "Set ORS_API_KEY in your environment to enable commute-time regions.",
    );
  }
  const cacheKey = `commute-isochrone:${center[0].toFixed(6)},${center[1].toFixed(6)}:${normalizedMinutes.join(",")}`;
  return withMemoryCache(
    cacheKey,
    30 * 24 * 60 * 60 * 1_000,
    async () => {
      const url = new URL(
        "/v2/isochrones/driving-car",
        dependencies.orsBaseUrl ?? ORS_BASE_URL,
      );
      let payload: unknown;
      try {
        payload = await fetchJson(
          url,
          {
            method: "POST",
            headers: {
              Accept: "application/json, application/geo+json",
              Authorization: apiKey,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              locations: [center],
              range: normalizedMinutes.map((value) => value * 60),
              range_type: "time",
              location_type: "destination",
            }),
          },
          dependencies.fetch ?? fetch,
        );
      } catch (error) {
        throw new Error(`Isochrone request failed: ${errorMessage(error)}`);
      }
      return normalizeIsochrones(payload, normalizedMinutes);
    },
  );
}

export function clearCommuteMemoryCache() {
  requestCache.clear();
}
