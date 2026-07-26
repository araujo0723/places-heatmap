import type { FeatureCollection, MultiPolygon, Polygon } from "geojson";
import type { AddressSelection } from "../../core/address-search";
import type { IsochroneProperties } from "./server/commute";

export type { AddressSelection } from "../../core/address-search";

export type ClientIsochroneCollection = FeatureCollection<
  Polygon | MultiPolygon,
  IsochroneProperties
>;

const isochroneCache = new Map<string, Promise<ClientIsochroneCollection>>();

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
