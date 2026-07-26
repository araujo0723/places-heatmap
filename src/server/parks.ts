import { createClient, type RedisClientType } from "redis";
import {
  boundsIntersect,
  tileBounds,
  tileKey,
  type GeoBounds,
  type MapTile,
} from "../core/geo";
import type { ParkRecord } from "../core/parks";

interface CachedTile {
  expiresAt: number;
  parks: ParkRecord[];
}

interface OverpassElement {
  id?: unknown;
  type?: unknown;
  lat?: unknown;
  lon?: unknown;
  center?: {
    lat?: unknown;
    lon?: unknown;
  };
  bounds?: {
    minlat?: unknown;
    minlon?: unknown;
    maxlat?: unknown;
    maxlon?: unknown;
  };
  tags?: {
    name?: unknown;
  };
}

interface OrsFeature {
  geometry?: {
    type?: unknown;
    coordinates?: unknown;
  };
  properties?: {
    osm_id?: unknown;
    osm_type?: unknown;
    osm_tags?: {
      name?: unknown;
    };
  };
}

export interface ParkServiceDependencies {
  now?: () => number;
  fetch?: typeof fetch;
  redis?: Pick<RedisClientType, "mGet" | "multi">;
  overpassUrl?: string;
  orsApiKey?: string;
}

export const PARK_CACHE_TTL_SECONDS = 365 * 24 * 60 * 60;
const CACHE_PREFIX = "places-heatmap:parks:v1:";
const memoryCache = new Map<string, CachedTile>();
const inFlight = new Map<string, Promise<Map<string, ParkRecord[]>>>();
let redisPromise: Promise<RedisClientType | undefined> | undefined;
let redisRetryAfter = 0;

function serverEnvironmentValue(
  name: "REDIS_URL" | "OVERPASS_API_URL" | "ORS_API_KEY",
) {
  return process.env[name] || import.meta.env[name];
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function validCoordinate(longitude: unknown, latitude: unknown) {
  return (
    finiteNumber(longitude) &&
    longitude >= -180 &&
    longitude <= 180 &&
    finiteNumber(latitude) &&
    latitude >= -90 &&
    latitude <= 90
  );
}

export function normalizeOverpassElements(
  elements: unknown,
): ParkRecord[] {
  if (!Array.isArray(elements)) {
    throw new Error("Overpass returned an invalid elements collection.");
  }

  const parks = new Map<string, ParkRecord>();
  for (const rawElement of elements) {
    if (!rawElement || typeof rawElement !== "object") continue;
    const element = rawElement as OverpassElement;
    if (
      !finiteNumber(element.id) ||
      !["node", "way", "relation"].includes(String(element.type))
    ) {
      continue;
    }

    const id = `${element.type}/${element.id}`;
    const bounds = element.bounds;
    let bbox: GeoBounds | undefined;
    if (
      bounds &&
      finiteNumber(bounds.minlon) &&
      finiteNumber(bounds.minlat) &&
      finiteNumber(bounds.maxlon) &&
      finiteNumber(bounds.maxlat) &&
      validCoordinate(bounds.minlon, bounds.minlat) &&
      validCoordinate(bounds.maxlon, bounds.maxlat) &&
      bounds.minlon <= bounds.maxlon &&
      bounds.minlat <= bounds.maxlat
    ) {
      bbox = {
        west: bounds.minlon,
        south: bounds.minlat,
        east: bounds.maxlon,
        north: bounds.maxlat,
      };
    }
    let longitude: number | undefined;
    let latitude: number | undefined;
    if (
      finiteNumber(element.lon) &&
      finiteNumber(element.lat) &&
      validCoordinate(element.lon, element.lat)
    ) {
      longitude = element.lon;
      latitude = element.lat;
    } else if (
      finiteNumber(element.center?.lon) &&
      finiteNumber(element.center?.lat) &&
      validCoordinate(element.center.lon, element.center.lat)
    ) {
      longitude = element.center.lon;
      latitude = element.center.lat;
    } else if (bbox) {
      longitude = (bbox.west + bbox.east) / 2;
      latitude = (bbox.south + bbox.north) / 2;
    }
    if (
      longitude === undefined ||
      latitude === undefined ||
      !validCoordinate(longitude, latitude)
    )
      continue;

    const name =
      typeof element.tags?.name === "string" && element.tags.name.trim()
        ? element.tags.name.trim()
        : undefined;
    parks.set(id, {
      id,
      ...(name ? { name } : {}),
      center: [longitude, latitude],
      ...(bbox ? { bbox } : {}),
    });
  }
  return [...parks.values()];
}

export function normalizeOrsFeatures(features: unknown): ParkRecord[] {
  if (!Array.isArray(features)) {
    throw new Error("ORS returned an invalid features collection.");
  }
  const typeNames: Record<number, string> = {
    1: "node",
    2: "way",
    3: "relation",
  };
  const parks = new Map<string, ParkRecord>();
  for (const rawFeature of features) {
    if (!rawFeature || typeof rawFeature !== "object") continue;
    const feature = rawFeature as OrsFeature;
    const coordinates = feature.geometry?.coordinates;
    const osmId = feature.properties?.osm_id;
    const osmType = feature.properties?.osm_type;
    if (
      feature.geometry?.type !== "Point" ||
      !Array.isArray(coordinates) ||
      !validCoordinate(coordinates[0], coordinates[1]) ||
      !finiteNumber(osmId) ||
      !finiteNumber(osmType) ||
      !typeNames[osmType]
    ) {
      continue;
    }
    const name =
      typeof feature.properties?.osm_tags?.name === "string" &&
      feature.properties.osm_tags.name.trim()
        ? feature.properties.osm_tags.name.trim()
        : undefined;
    const id = `${typeNames[osmType]}/${osmId}`;
    parks.set(id, {
      id,
      ...(name ? { name } : {}),
      center: [coordinates[0] as number, coordinates[1] as number],
    });
  }
  return [...parks.values()];
}

function parkBounds(park: ParkRecord): GeoBounds {
  return (
    park.bbox ?? {
      west: park.center[0],
      south: park.center[1],
      east: park.center[0],
      north: park.center[1],
    }
  );
}

function overpassQuery(tiles: MapTile[]) {
  const clauses = tiles
    .map((tile) => {
      const bounds = tileBounds(tile);
      return `nwr["leisure"="park"](${bounds.south},${bounds.west},${bounds.north},${bounds.east});`;
    })
    .join("\n");
  return `[out:json][timeout:25];\n(\n${clauses}\n);\nout tags center bb;`;
}

async function fetchJson(
  url: string,
  init: RequestInit,
  fetchImplementation: typeof fetch,
  timeoutMilliseconds = 30_000,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMilliseconds);
  try {
    const response = await fetchImplementation(url, {
      ...init,
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`request failed with status ${response.status}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchOverpassParks(
  tiles: MapTile[],
  fetchImplementation: typeof fetch,
  overpassUrl: string,
) {
  const payload = (await fetchJson(
    overpassUrl,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        "User-Agent": "places-heatmap/0.1",
      },
      body: new URLSearchParams({ data: overpassQuery(tiles) }),
    },
    fetchImplementation,
  )) as { elements?: unknown };
  return normalizeOverpassElements(payload?.elements);
}

function subdivideBounds(bounds: GeoBounds, divisions = 3) {
  const longitudeStep = (bounds.east - bounds.west) / divisions;
  const latitudeStep = (bounds.north - bounds.south) / divisions;
  return Array.from({ length: divisions * divisions }, (_, index) => {
    const x = index % divisions;
    const y = Math.floor(index / divisions);
    return {
      west: bounds.west + longitudeStep * x,
      south: bounds.south + latitudeStep * y,
      east: bounds.west + longitudeStep * (x + 1),
      north: bounds.south + latitudeStep * (y + 1),
    };
  });
}

async function mapWithConcurrency<Input, Output>(
  inputs: Input[],
  concurrency: number,
  operation: (input: Input) => Promise<Output>,
) {
  const outputs: Output[] = new Array(inputs.length);
  let nextIndex = 0;
  await Promise.all(
    Array.from(
      { length: Math.min(concurrency, inputs.length) },
      async () => {
        while (nextIndex < inputs.length) {
          const index = nextIndex;
          nextIndex += 1;
          outputs[index] = await operation(inputs[index]);
        }
      },
    ),
  );
  return outputs;
}

async function fetchOrsParks(
  tiles: MapTile[],
  fetchImplementation: typeof fetch,
  apiKey: string,
) {
  const queryBounds = tiles.flatMap((tile) => subdivideBounds(tileBounds(tile)));
  const results = await mapWithConcurrency(queryBounds, 4, async (bounds) => {
    const payload = (await fetchJson(
      "https://api.openrouteservice.org/pois",
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          request: "pois",
          geometry: {
            bbox: [
              [bounds.west, bounds.south],
              [bounds.east, bounds.north],
            ],
          },
          filters: { category_ids: [280] },
          limit: 2_000,
        }),
      },
      fetchImplementation,
      20_000,
    )) as { features?: unknown };
    return normalizeOrsFeatures(payload?.features);
  });
  const parks = new Map<string, ParkRecord>();
  for (const result of results) {
    for (const park of result) {
      parks.set(park.id, park);
    }
  }
  return [...parks.values()];
}

async function fetchMissingTiles(
  tiles: MapTile[],
  fetchImplementation: typeof fetch,
  overpassUrl: string,
  orsApiKey?: string,
): Promise<Map<string, ParkRecord[]>> {
  const errors: string[] = [];
  let parks: ParkRecord[] | undefined;
  try {
    parks = await fetchOverpassParks(tiles, fetchImplementation, overpassUrl);
  } catch (error) {
    errors.push(`Overpass ${errorMessage(error)}`);
  }
  if (!parks && orsApiKey) {
    try {
      parks = await fetchOrsParks(tiles, fetchImplementation, orsApiKey);
    } catch (error) {
      errors.push(`ORS ${errorMessage(error)}`);
    }
  }
  if (!parks && overpassUrl === "https://overpass-api.de/api/interpreter") {
    try {
      parks = await fetchOverpassParks(
        tiles,
        fetchImplementation,
        "https://overpass.private.coffee/api/interpreter",
      );
    } catch (error) {
      errors.push(`fallback Overpass ${errorMessage(error)}`);
    }
  }
  if (!parks) {
    throw new Error(`Park providers unavailable: ${errors.join("; ")}.`);
  }

  return new Map(
    tiles.map((tile) => {
      const bounds = tileBounds(tile);
      return [
        tileKey(tile),
        parks.filter((park) => boundsIntersect(parkBounds(park), bounds)),
      ];
    }),
  );
}

function errorMessage(error: unknown) {
  if (error instanceof Error && error.name === "AbortError") return "timed out";
  return error instanceof Error ? error.message : "failed";
}

async function defaultRedis(): Promise<RedisClientType | undefined> {
  const url = serverEnvironmentValue("REDIS_URL");
  if (!url) return undefined;
  if (!redisPromise && Date.now() < redisRetryAfter) return undefined;
  if (!redisPromise) {
    redisPromise = (async () => {
      const client = createClient({
        url,
        disableOfflineQueue: true,
        socket: {
          connectTimeout: 2_000,
          reconnectStrategy: false,
        },
      });
      client.on("error", () => {
        // Requests fall back to process memory and Overpass.
      });
      try {
        await client.connect();
        return client as RedisClientType;
      } catch {
        client.destroy();
        return undefined;
      }
    })();
  }
  const client = await redisPromise;
  if (!client) {
    redisPromise = undefined;
    redisRetryAfter = Date.now() + 30_000;
  }
  return client;
}

export async function getParksForTiles(
  tiles: MapTile[],
  dependencies: ParkServiceDependencies = {},
): Promise<ParkRecord[]> {
  const now = dependencies.now?.() ?? Date.now();
  const redis = dependencies.redis ?? (await defaultRedis());
  const tileResults = new Map<string, ParkRecord[]>();
  const unresolved: MapTile[] = [];

  for (const tile of tiles) {
    const key = tileKey(tile);
    const cached = memoryCache.get(key);
    if (cached && cached.expiresAt > now) {
      tileResults.set(key, cached.parks);
    } else {
      unresolved.push(tile);
    }
  }

  if (redis && unresolved.length) {
    try {
      const values = await redis.mGet(
        unresolved.map((tile) => `${CACHE_PREFIX}${tileKey(tile)}`),
      );
      const stillMissing: MapTile[] = [];
      unresolved.forEach((tile, index) => {
        const key = tileKey(tile);
        const value = values[index];
        if (!value) {
          stillMissing.push(tile);
          return;
        }
        try {
          const parks = JSON.parse(value) as ParkRecord[];
          if (!Array.isArray(parks)) throw new Error("Invalid cached value");
          tileResults.set(key, parks);
          memoryCache.set(key, {
            parks,
            expiresAt: now + PARK_CACHE_TTL_SECONDS * 1_000,
          });
        } catch {
          stillMissing.push(tile);
        }
      });
      unresolved.splice(0, unresolved.length, ...stillMissing);
    } catch {
      // Continue through the live data path.
    }
  }

  if (unresolved.length) {
    const requestKey = unresolved.map(tileKey).sort().join(",");
    let request = inFlight.get(requestKey);
    if (!request) {
      request = fetchMissingTiles(
        unresolved,
        dependencies.fetch ?? fetch,
        dependencies.overpassUrl ??
          serverEnvironmentValue("OVERPASS_API_URL") ??
          "https://overpass-api.de/api/interpreter",
        dependencies.orsApiKey ?? serverEnvironmentValue("ORS_API_KEY"),
      );
      inFlight.set(requestKey, request);
      request.finally(() => inFlight.delete(requestKey)).catch(() => undefined);
    }
    const fetched = await request;
    for (const tile of unresolved) {
      const key = tileKey(tile);
      const parks = fetched.get(key) ?? [];
      tileResults.set(key, parks);
      memoryCache.set(key, {
        parks,
        expiresAt: now + PARK_CACHE_TTL_SECONDS * 1_000,
      });
    }
    if (redis) {
      try {
        const transaction = redis.multi();
        for (const tile of unresolved) {
          const key = tileKey(tile);
          transaction.set(
            `${CACHE_PREFIX}${key}`,
            JSON.stringify(fetched.get(key) ?? []),
            { EX: PARK_CACHE_TTL_SECONDS },
          );
        }
        await transaction.exec();
      } catch {
        // The in-process cache still prevents immediate repeat requests.
      }
    }
  }

  const parks = new Map<string, ParkRecord>();
  for (const tile of tiles) {
    for (const park of tileResults.get(tileKey(tile)) ?? []) {
      parks.set(park.id, park);
    }
  }
  return [...parks.values()];
}

export function clearParkMemoryCache() {
  memoryCache.clear();
  inFlight.clear();
}
