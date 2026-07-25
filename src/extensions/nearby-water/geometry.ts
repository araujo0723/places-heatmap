import type { FeatureCollection } from "geojson";
import type { WaterRecord } from "../../core/water";
import type {
  RegionGeometry,
  SurfaceProperties,
} from "../api";
import {
  parkFilterRegions,
  parkHeatContours,
} from "../nearby-parks/geometry";

export function waterFilterRegions(
  waters: WaterRecord[],
  distance: number,
) {
  const { regions, itemCount } = parkFilterRegions(waters, distance);
  return {
    regions: regions.map((region) => {
      const { parkId, ...properties } = region.properties ?? {};
      return {
        ...region,
        properties: { ...properties, waterId: parkId },
      };
    }),
    itemCount,
  };
}

export function waterHeatContours(
  waters: WaterRecord[],
): FeatureCollection<RegionGeometry, SurfaceProperties> {
  const collection = parkHeatContours(waters);
  return {
    ...collection,
    features: collection.features.map((feature) => ({
      ...feature,
      id:
        typeof feature.id === "string"
          ? feature.id.replace(/^park-/, "water-")
          : feature.id,
    })),
  };
}
