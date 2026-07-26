import {
  boundsIntersect,
  MAX_NEARBY_AREA_TILES,
  tileKey,
  waterQueryCoverage,
  type MapTile,
} from "../../core/geo";
import type { WaterRecord } from "../../core/water";
import type { MapViewport } from "../api";

interface WaterResponse {
  waters?: unknown;
}

interface CacheEntry {
  expiresAt: number;
  promise: Promise<WaterRecord[]>;
}

const SIX_HOURS = 21_600_000;
const cache = new Map<string, CacheEntry>();

function isWaterRecord(value: unknown): value is WaterRecord {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<WaterRecord>;
  return (
    typeof candidate.id === "string" &&
    Array.isArray(candidate.center) &&
    candidate.center.length === 2 &&
    candidate.center.every(
      (coordinate) =>
        typeof coordinate === "number" && Number.isFinite(coordinate),
    )
  );
}

function waterBounds(water: WaterRecord) {
  return (
    water.bbox ?? {
      west: water.center[0],
      south: water.center[1],
      east: water.center[0],
      north: water.center[1],
    }
  );
}

function tileBatches(tiles: MapTile[]) {
  return Array.from(
    { length: Math.ceil(tiles.length / MAX_NEARBY_AREA_TILES) },
    (_, index) =>
      tiles.slice(
        index * MAX_NEARBY_AREA_TILES,
        (index + 1) * MAX_NEARBY_AREA_TILES,
      ),
  );
}

async function loadWaterBatch(tiles: MapTile[]) {
  const tileKeys = tiles.map(tileKey).sort();
  const response = await fetch(
    `/api/water?tiles=${encodeURIComponent(tileKeys.join(","))}`,
  );
  const payload = (await response.json().catch(() => ({}))) as
    | WaterResponse
    | { error?: unknown };
  if (!response.ok) {
    throw new Error(
      typeof (payload as { error?: unknown }).error === "string"
        ? String((payload as { error: string }).error)
        : "Nearby water could not be loaded.",
    );
  }
  const waters = (payload as WaterResponse).waters;
  if (!Array.isArray(waters) || !waters.every(isWaterRecord)) {
    throw new Error("Nearby water returned malformed data.");
  }
  return waters;
}

export async function loadNearbyWater(
  viewport: MapViewport,
  signal: AbortSignal,
): Promise<WaterRecord[]> {
  const coverage = waterQueryCoverage(viewport);
  const now = Date.now();
  let entry = cache.get(coverage.key);
  if (!entry || entry.expiresAt <= now) {
    const promise = Promise.all(
      tileBatches(coverage.tiles).map(loadWaterBatch),
    )
      .then((batches) => {
        const waters = new Map<string, WaterRecord>();
        for (const batch of batches) {
          for (const water of batch) {
            waters.set(water.id, water);
          }
        }
        return [...waters.values()];
      })
      .catch((error) => {
        cache.delete(coverage.key);
        throw error;
      });
    entry = { expiresAt: now + SIX_HOURS, promise };
    cache.set(coverage.key, entry);
  }

  const waters = await entry.promise;
  signal.throwIfAborted();
  return waters.filter((water) =>
    boundsIntersect(waterBounds(water), coverage.bounds),
  );
}

export function clearNearbyWaterCache() {
  cache.clear();
}
