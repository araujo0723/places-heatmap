import { createClient, type RedisClientType } from "redis";
import {
  boundsIntersect,
  tileBounds,
  tileKey,
  type GeoBounds,
  type MapTile,
} from "../core/geo";
import type { WaterRecord } from "../core/water";
import { normalizeOverpassElements } from "./parks";

interface CachedTile {
  expiresAt: number;
  waters: WaterRecord[];
}

export interface WaterServiceDependencies {
  now?: () => number;
  fetch?: typeof fetch;
  redis?: Pick<RedisClientType, "mGet" | "multi">;
  overpassUrl?: string;
}

export const WATER_CACHE_TTL_SECONDS = 365 * 24 * 60 * 60;
const CACHE_PREFIX = "places-heatmap:water:v1:";
const memoryCache = new Map<string, CachedTile>();
const inFlight = new Map<string, Promise<Map<string, WaterRecord[]>>>();
let redisPromise: Promise<RedisClientType | undefined> | undefined;
let redisRetryAfter = 0;

function serverEnvironmentValue(name: "REDIS_URL" | "OVERPASS_API_URL") {
  return process.env[name] || import.meta.env[name];
}

export function normalizeWaterElements(elements: unknown): WaterRecord[] {
  return normalizeOverpassElements(elements);
}

function waterBounds(water: WaterRecord): GeoBounds {
  return (
    water.bbox ?? {
      west: water.center[0],
      south: water.center[1],
      east: water.center[0],
      north: water.center[1],
    }
  );
}

export function waterOverpassQuery(tiles: MapTile[]) {
  const clauses = tiles
    .flatMap((tile) => {
      const bounds = tileBounds(tile);
      const bbox =
        `${bounds.south},${bounds.west},${bounds.north},${bounds.east}`;
      return [
        `nwr["natural"="water"][!"water"](${bbox});`,
        `nwr["natural"="water"]["water"~"^(lake|pond|reservoir|basin|lagoon|oxbow|cenote|stream_pool|reflecting_pool|moat|fishpond)$"](${bbox});`,
        `nwr["landuse"="reservoir"](${bbox});`,
        `nwr["landuse"="salt_pond"](${bbox});`,
      ];
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

async function fetchOverpassWater(
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
      body: new URLSearchParams({ data: waterOverpassQuery(tiles) }),
    },
    fetchImplementation,
  )) as { elements?: unknown };
  return normalizeWaterElements(payload?.elements);
}

function errorMessage(error: unknown) {
  if (error instanceof Error && error.name === "AbortError") return "timed out";
  return error instanceof Error ? error.message : "failed";
}

async function fetchMissingTiles(
  tiles: MapTile[],
  fetchImplementation: typeof fetch,
  overpassUrl: string,
): Promise<Map<string, WaterRecord[]>> {
  const errors: string[] = [];
  let waters: WaterRecord[] | undefined;
  try {
    waters = await fetchOverpassWater(
      tiles,
      fetchImplementation,
      overpassUrl,
    );
  } catch (error) {
    errors.push(`Overpass ${errorMessage(error)}`);
  }
  if (!waters && overpassUrl === "https://overpass-api.de/api/interpreter") {
    try {
      waters = await fetchOverpassWater(
        tiles,
        fetchImplementation,
        "https://overpass.private.coffee/api/interpreter",
      );
    } catch (error) {
      errors.push(`fallback Overpass ${errorMessage(error)}`);
    }
  }
  if (!waters) {
    throw new Error(`Water providers unavailable: ${errors.join("; ")}.`);
  }

  return new Map(
    tiles.map((tile) => {
      const bounds = tileBounds(tile);
      return [
        tileKey(tile),
        waters.filter((water) =>
          boundsIntersect(waterBounds(water), bounds),
        ),
      ];
    }),
  );
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

export async function getWaterForTiles(
  tiles: MapTile[],
  dependencies: WaterServiceDependencies = {},
): Promise<WaterRecord[]> {
  const now = dependencies.now?.() ?? Date.now();
  const redis = dependencies.redis ?? (await defaultRedis());
  const tileResults = new Map<string, WaterRecord[]>();
  const unresolved: MapTile[] = [];

  for (const tile of tiles) {
    const key = tileKey(tile);
    const cached = memoryCache.get(key);
    if (cached && cached.expiresAt > now) {
      tileResults.set(key, cached.waters);
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
          const waters = JSON.parse(value) as WaterRecord[];
          if (!Array.isArray(waters)) throw new Error("Invalid cached value");
          tileResults.set(key, waters);
          memoryCache.set(key, {
            waters,
            expiresAt: now + WATER_CACHE_TTL_SECONDS * 1_000,
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
      );
      inFlight.set(requestKey, request);
      request.finally(() => inFlight.delete(requestKey)).catch(() => undefined);
    }
    const fetched = await request;
    for (const tile of unresolved) {
      const key = tileKey(tile);
      const waters = fetched.get(key) ?? [];
      tileResults.set(key, waters);
      memoryCache.set(key, {
        waters,
        expiresAt: now + WATER_CACHE_TTL_SECONDS * 1_000,
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
            { EX: WATER_CACHE_TTL_SECONDS },
          );
        }
        await transaction.exec();
      } catch {
        // The in-process cache still prevents immediate repeat requests.
      }
    }
  }

  const waters = new Map<string, WaterRecord>();
  for (const tile of tiles) {
    for (const water of tileResults.get(tileKey(tile)) ?? []) {
      waters.set(water.id, water);
    }
  }
  return [...waters.values()];
}

export function clearWaterMemoryCache() {
  memoryCache.clear();
  inFlight.clear();
}
