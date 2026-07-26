import type { FeatureCollection, MultiPolygon, Polygon } from "geojson";
import type { IsochroneProperties } from "../../server/commute";

export interface AddressSelection {
  label: string;
  address: string;
  center: [number, number];
}

export type ClientIsochroneCollection = FeatureCollection<
  Polygon | MultiPolygon,
  IsochroneProperties
>;

const isochroneCache = new Map<string, Promise<ClientIsochroneCollection>>();

function validCoordinate(value: unknown): value is [number, number] {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    value.every(
      (coordinate) =>
        typeof coordinate === "number" && Number.isFinite(coordinate),
    )
  );
}

function isAddressSelection(value: unknown): value is AddressSelection {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<AddressSelection>;
  return (
    typeof candidate.label === "string" &&
    typeof candidate.address === "string" &&
    validCoordinate(candidate.center)
  );
}

export async function searchAddresses(
  query: string,
  signal: AbortSignal,
  proximity: [number, number],
): Promise<AddressSelection[]> {
  const parameters = new URLSearchParams({
    q: query,
    longitude: String(proximity[0]),
    latitude: String(proximity[1]),
  });
  const response = await fetch(
    `/api/address-suggestions?${parameters}`,
    { signal },
  );
  const payload = (await response.json().catch(() => ({}))) as {
    suggestions?: unknown;
    message?: unknown;
  };
  if (!response.ok) {
    throw new Error(
      typeof payload.message === "string"
        ? payload.message
        : "Address lookup failed.",
    );
  }
  if (
    !Array.isArray(payload.suggestions) ||
    !payload.suggestions.every(isAddressSelection)
  ) {
    throw new Error("Address lookup returned malformed data.");
  }
  return payload.suggestions;
}

export async function loadDrivingIsochrones(
  address: AddressSelection,
  minutes: number[],
  signal: AbortSignal,
): Promise<ClientIsochroneCollection> {
  const normalizedMinutes = [...minutes].sort(
    (first, second) => first - second,
  );
  const key = `${address.center[0].toFixed(6)},${address.center[1].toFixed(6)}:${normalizedMinutes.join(",")}`;
  let request = isochroneCache.get(key);
  if (!request) {
    request = fetch("/api/commute/isochrones", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        center: address.center,
        minutes: normalizedMinutes,
      }),
    })
      .then(async (response) => {
        const payload = (await response.json().catch(() => ({}))) as
          | ClientIsochroneCollection
          | { error?: unknown };
        if (!response.ok) {
          throw new Error(
            "error" in payload && typeof payload.error === "string"
              ? payload.error
              : "Commute-time regions could not be loaded.",
          );
        }
        if (
          !("type" in payload) ||
          payload.type !== "FeatureCollection" ||
          !Array.isArray(payload.features)
        ) {
          throw new Error("Commute-time regions returned malformed data.");
        }
        return payload;
      })
      .catch((error) => {
        isochroneCache.delete(key);
        throw error;
      });
    isochroneCache.set(key, request);
  }

  const collection = await request;
  signal.throwIfAborted();
  return collection;
}

export function clearCommuteClientCache() {
  isochroneCache.clear();
}
