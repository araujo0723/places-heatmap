import { boundsIntersect, waterQueryCoverage } from "../../core/geo";
import type { MapViewport } from "../api";
import type { WaterRecord } from "./core/water";

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

async function loadWater(viewport: MapViewport) {
  const { bounds } = waterQueryCoverage(viewport);
  const query = new URLSearchParams({
    west: String(bounds.west),
    south: String(bounds.south),
    east: String(bounds.east),
    north: String(bounds.north),
  });
  const response = await fetch(`/api/water?${query}`);
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
    const promise = loadWater(viewport).catch((error) => {
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
