import { createHash } from "node:crypto";
import { createClient } from "redis";
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
  redis?: RedisIsochroneCache | null;
}

export interface RedisIsochroneCache {
  get(key: string): Promise<string | null>;
  set(
    key: string,
    value: string,
    options: { EX: number },
  ): Promise<unknown>;
}

const ORS_BASE_URL = "https://api.openrouteservice.org";
const DEFAULT_REDIS_URL = "redis://127.0.0.1:6379";
export const ISOCHRONE_CACHE_TTL_MILLISECONDS =
  365 * 24 * 60 * 60 * 1_000;
export const ISOCHRONE_CACHE_TTL_SECONDS =
  ISOCHRONE_CACHE_TTL_MILLISECONDS / 1_000;
const requestCache = new Map<
  string,
  { expiresAt: number; value: Promise<IsochroneCollection> }
>();
let redisClient: ReturnType<typeof createClient> | undefined;
let redisConnection:
  | Promise<ReturnType<typeof createClient> | null>
  | undefined;

function serverEnvironmentValue(name: "ORS_API_KEY" | "REDIS_URL") {
  return process.env[name] || import.meta.env[name];
}

async function localRedisCache(): Promise<RedisIsochroneCache | null> {
  if (redisClient?.isReady) return redisClient;
  if (redisConnection) return redisConnection;

  redisConnection = (async () => {
    const client = createClient({
      url: serverEnvironmentValue("REDIS_URL") || DEFAULT_REDIS_URL,
      socket: {
        connectTimeout: 500,
        reconnectStrategy: false,
      },
    });
    client.on("error", () => {
      // Redis is an optimization; routing still works if the local cache is down.
    });
    try {
      await client.connect();
      redisClient = client;
      return client;
    } catch {
      client.destroy();
      return null;
    } finally {
      redisConnection = undefined;
    }
  })();
  return redisConnection;
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

export function commuteIsochroneCacheKey(
  destination: Coordinate,
  commuteMinutes: number,
) {
  const input = JSON.stringify({
    profile: "driving-car",
    locationType: "destination",
    destination: destination.map((value) => value.toFixed(6)),
    commuteMinutes,
  });
  return `places-heatmap:commute:isochrone:v1:${createHash("sha256")
    .update(input)
    .digest("hex")}`;
}

function parseCachedIsochrone(
  serialized: string,
  requestedMinutes: number,
): Feature<Polygon | MultiPolygon, IsochroneProperties> | null {
  try {
    const value = JSON.parse(serialized) as {
      type?: unknown;
      geometry?: { type?: unknown; coordinates?: unknown };
      properties?: { minutes?: unknown };
    };
    const type = value.geometry?.type;
    const coordinates = value.geometry?.coordinates;
    if (
      value.type !== "Feature" ||
      value.properties?.minutes !== requestedMinutes
    ) {
      return null;
    }
    if (type === "Polygon" && validPolygonCoordinates(coordinates)) {
      return value as Feature<Polygon, IsochroneProperties>;
    }
    if (
      type === "MultiPolygon" &&
      validMultiPolygonCoordinates(coordinates)
    ) {
      return value as Feature<MultiPolygon, IsochroneProperties>;
    }
  } catch {
    // Treat malformed or outdated entries as a cache miss.
  }
  return null;
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

  const cacheKey = `${center[0].toFixed(6)},${center[1].toFixed(6)}:${normalizedMinutes.join(",")}`;
  const cached = requestCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const value = (async () => {
    const persistentCache =
      dependencies.redis === undefined
        ? await localRedisCache()
        : dependencies.redis;
    const cachedContours = new Map<
      number,
      Feature<Polygon | MultiPolygon, IsochroneProperties>
    >();
    if (persistentCache) {
      await Promise.all(
        normalizedMinutes.map(async (commuteMinutes) => {
          try {
            const serialized = await persistentCache.get(
              commuteIsochroneCacheKey(center, commuteMinutes),
            );
            if (!serialized) return;
            const contour = parseCachedIsochrone(
              serialized,
              commuteMinutes,
            );
            if (contour) cachedContours.set(commuteMinutes, contour);
          } catch {
            // Continue with openrouteservice when Redis is unavailable.
          }
        }),
      );
    }

    const missingMinutes = normalizedMinutes.filter(
      (commuteMinutes) => !cachedContours.has(commuteMinutes),
    );
    if (missingMinutes.length === 0) {
      return {
        type: "FeatureCollection",
        features: normalizedMinutes.map(
          (commuteMinutes) => cachedContours.get(commuteMinutes)!,
        ),
      } satisfies IsochroneCollection;
    }

    const apiKey =
      dependencies.orsApiKey ?? serverEnvironmentValue("ORS_API_KEY");
    if (!apiKey) {
      throw new Error(
        "Set ORS_API_KEY in your environment to enable commute-time regions.",
      );
    }
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
            range: missingMinutes.map((value) => value * 60),
            range_type: "time",
            location_type: "destination",
          }),
        },
        dependencies.fetch ?? fetch,
      );
    } catch (error) {
      throw new Error(`Isochrone request failed: ${errorMessage(error)}`);
    }
    const fetchedCollection = normalizeIsochrones(payload, missingMinutes);
    if (persistentCache) {
      await Promise.all(
        fetchedCollection.features.map(async (contour) => {
          try {
            await persistentCache.set(
              commuteIsochroneCacheKey(
                center,
                contour.properties.minutes,
              ),
              JSON.stringify(contour),
              { EX: ISOCHRONE_CACHE_TTL_SECONDS },
            );
          } catch {
            // A cache write failure should not discard a valid routing result.
          }
        }),
      );
    }

    for (const contour of fetchedCollection.features) {
      cachedContours.set(contour.properties.minutes, contour);
    }
    return {
      type: "FeatureCollection",
      features: normalizedMinutes.flatMap((commuteMinutes) => {
        const contour = cachedContours.get(commuteMinutes);
        return contour ? [contour] : [];
      }),
    } satisfies IsochroneCollection;
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
