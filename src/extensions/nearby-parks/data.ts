import {
  boundsIntersect,
  MAX_PARK_TILES,
  parkQueryCoverage,
  tileKey,
  type MapTile,
} from "../../core/geo";
import type { ParkRecord } from "../../core/parks";
import type { MapViewport } from "../api";

interface ParkResponse {
  parks?: unknown;
}

interface CacheEntry {
  expiresAt: number;
  promise: Promise<ParkRecord[]>;
}

const SIX_HOURS = 21_600_000;
const cache = new Map<string, CacheEntry>();

function isParkRecord(value: unknown): value is ParkRecord {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ParkRecord>;
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

function parkBounds(park: ParkRecord) {
  return (
    park.bbox ?? {
      west: park.center[0],
      south: park.center[1],
      east: park.center[0],
      north: park.center[1],
    }
  );
}

function tileBatches(tiles: MapTile[]) {
  return Array.from(
    { length: Math.ceil(tiles.length / MAX_PARK_TILES) },
    (_, index) =>
      tiles.slice(
        index * MAX_PARK_TILES,
        (index + 1) * MAX_PARK_TILES,
      ),
  );
}

async function loadParkBatch(tiles: MapTile[]) {
  const tileKeys = tiles.map(tileKey).sort();
  const response = await fetch(
    `/api/parks?tiles=${encodeURIComponent(tileKeys.join(","))}`,
  );
  const payload = (await response.json().catch(() => ({}))) as
    | ParkResponse
    | { error?: unknown };
  if (!response.ok) {
    throw new Error(
      typeof (payload as { error?: unknown }).error === "string"
        ? String((payload as { error: string }).error)
        : "Nearby parks could not be loaded.",
    );
  }
  const parks = (payload as ParkResponse).parks;
  if (!Array.isArray(parks) || !parks.every(isParkRecord)) {
    throw new Error("Nearby parks returned malformed data.");
  }
  return parks;
}

export async function loadNearbyParks(
  viewport: MapViewport,
  signal: AbortSignal,
): Promise<ParkRecord[]> {
  const coverage = parkQueryCoverage(viewport);
  const now = Date.now();
  let entry = cache.get(coverage.key);
  if (!entry || entry.expiresAt <= now) {
    const promise = Promise.all(
      tileBatches(coverage.tiles).map(loadParkBatch),
    )
      .then((batches) => {
        const parks = new Map<string, ParkRecord>();
        for (const batch of batches) {
          for (const park of batch) parks.set(park.id, park);
        }
        return [...parks.values()];
      })
      .catch((error) => {
        cache.delete(coverage.key);
        throw error;
      });
    entry = { expiresAt: now + SIX_HOURS, promise };
    cache.set(coverage.key, entry);
  }

  const parks = await entry.promise;
  signal.throwIfAborted();
  return parks.filter((park) =>
    boundsIntersect(parkBounds(park), coverage.bounds),
  );
}

export function clearNearbyParkCache() {
  cache.clear();
}
