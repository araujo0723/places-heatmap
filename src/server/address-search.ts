export type Coordinate = [number, number];

export interface AddressSuggestion {
  label: string;
  address: string;
  center: Coordinate;
}

export interface AddressSearchDependencies {
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
  { expiresAt: number; value: Promise<AddressSuggestion[]> }
>();

function serverEnvironmentValue(name: "ORS_API_KEY") {
  return process.env[name] || import.meta.env[name];
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
      const center: Coordinate = [
        Number(candidate.lon),
        Number(candidate.lat),
      ];
      const address =
        typeof candidate.display_name === "string"
          ? candidate.display_name.trim()
          : "";
      if (!address || !validCoordinate(center)) return [];
      return [{ label: address, address, center }];
    }),
  );
}

export function normalizeOrsSuggestions(
  payload: unknown,
): AddressSuggestion[] {
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
  dependencies: AddressSearchDependencies,
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
  dependencies: AddressSearchDependencies,
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
  dependencies: AddressSearchDependencies = {},
): Promise<AddressSuggestion[]> {
  const normalized = query.replace(/\s+/g, " ").trim();
  if (normalized.length < 3) return [];

  const key = `address:${normalized.toLowerCase()}:${
    dependencies.proximity
      ? dependencies.proximity
          .map((coordinate) => coordinate.toFixed(3))
          .join(",")
      : "global"
  }`;
  const cached = requestCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const value = (async () => {
    const apiKey =
      dependencies.orsApiKey ?? serverEnvironmentValue("ORS_API_KEY");
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
  })().catch((error) => {
    requestCache.delete(key);
    throw error;
  });
  requestCache.set(key, {
    expiresAt: Date.now() + 14 * 24 * 60 * 60 * 1_000,
    value,
  });
  return value;
}

export function clearAddressSearchCache() {
  requestCache.clear();
}
