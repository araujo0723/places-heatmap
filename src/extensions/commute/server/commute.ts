import type {
  Feature,
  FeatureCollection,
  MultiPolygon,
  Polygon,
  Position,
} from "geojson";

export type Coordinate = [number, number];

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
  orsBaseUrl?: string;
}

const ORS_BASE_URL = "https://api.openrouteservice.org";
export const ISOCHRONE_CACHE_TTL_MILLISECONDS =
  365 * 24 * 60 * 60 * 1_000;
const requestCache = new Map<
  string,
  { expiresAt: number; value: Promise<IsochroneCollection> }
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
    throw new Error(
      "Commute times must contain 1–10 values from 5 to 60 minutes.",
    );
  }

  const apiKey =
    dependencies.orsApiKey ?? serverEnvironmentValue("ORS_API_KEY");
  if (!apiKey) {
    throw new Error(
      "Set ORS_API_KEY in your environment to enable commute-time regions.",
    );
  }
  const cacheKey = `${center[0].toFixed(6)},${center[1].toFixed(6)}:${normalizedMinutes.join(",")}`;
  const cached = requestCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const value = (async () => {
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
  })().catch((error) => {
    requestCache.delete(cacheKey);
    throw error;
  });
  requestCache.set(cacheKey, {
    expiresAt: Date.now() + ISOCHRONE_CACHE_TTL_MILLISECONDS,
    value,
  });
  return value;
}

export function clearCommuteMemoryCache() {
  requestCache.clear();
}
