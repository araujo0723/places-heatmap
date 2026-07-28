import type { MapViewport, RegionGeometry } from "../api";
import type {
  IncomeCollection,
  IncomeFeature,
  IncomeProperties,
} from "./core/income";

interface IncomeResponse {
  regions?: unknown;
}

interface CacheEntry {
  expiresAt: number;
  promise: Promise<IncomeCollection>;
}

const SIX_HOURS = 21_600_000;
const cache = new Map<string, CacheEntry>();

function cacheKey(viewport: MapViewport) {
  const { west, south, east, north } = viewport.bounds;
  return [west, south, east, north]
    .map((coordinate) => coordinate.toFixed(6))
    .join(",");
}

function isGeometry(value: unknown): value is RegionGeometry {
  return (
    !!value &&
    typeof value === "object" &&
    "type" in value &&
    ((value as { type?: unknown }).type === "Polygon" ||
      (value as { type?: unknown }).type === "MultiPolygon") &&
    "coordinates" in value &&
    Array.isArray((value as { coordinates?: unknown }).coordinates)
  );
}

function isIncomeProperties(value: unknown): value is IncomeProperties {
  if (!value || typeof value !== "object") return false;
  const properties = value as Partial<IncomeProperties>;
  return (
    typeof properties.geoid === "string" &&
    /^\d{12}$/.test(properties.geoid) &&
    typeof properties.name === "string" &&
    typeof properties.income === "number" &&
    Number.isFinite(properties.income) &&
    typeof properties.weight === "number" &&
    Number.isFinite(properties.weight) &&
    (properties.marginOfError === undefined ||
      (typeof properties.marginOfError === "number" &&
        Number.isFinite(properties.marginOfError)))
  );
}

function isIncomeFeature(value: unknown): value is IncomeFeature {
  if (!value || typeof value !== "object") return false;
  const feature = value as Partial<IncomeFeature>;
  return (
    feature.type === "Feature" &&
    isGeometry(feature.geometry) &&
    isIncomeProperties(feature.properties)
  );
}

async function requestIncome(viewport: MapViewport) {
  const query = new URLSearchParams(
    Object.entries(viewport.bounds).map(([name, value]) => [
      name,
      String(value),
    ]),
  );
  const response = await fetch(`/api/median-household-income?${query}`);
  const payload = (await response.json().catch(() => ({}))) as
    | IncomeResponse
    | { error?: unknown };
  if (!response.ok) {
    throw new Error(
      typeof (payload as { error?: unknown }).error === "string"
        ? String((payload as { error: string }).error)
        : "Median household income could not be loaded.",
    );
  }

  const regions = (payload as IncomeResponse).regions;
  if (
    !regions ||
    typeof regions !== "object" ||
    (regions as { type?: unknown }).type !== "FeatureCollection" ||
    !Array.isArray((regions as { features?: unknown }).features) ||
    !(regions as { features: unknown[] }).features.every(isIncomeFeature)
  ) {
    throw new Error("Median household income returned malformed data.");
  }
  return regions as IncomeCollection;
}

export async function loadMedianHouseholdIncome(
  viewport: MapViewport,
  signal: AbortSignal,
) {
  const key = cacheKey(viewport);
  const now = Date.now();
  let entry = cache.get(key);
  if (!entry || entry.expiresAt <= now) {
    const promise = requestIncome(viewport).catch((error) => {
      cache.delete(key);
      throw error;
    });
    entry = { expiresAt: now + SIX_HOURS, promise };
    cache.set(key, entry);
  }

  const collection = await entry.promise;
  signal.throwIfAborted();
  return collection;
}

export function clearMedianHouseholdIncomeCache() {
  cache.clear();
}
