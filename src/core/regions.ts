import intersect from "@turf/intersect";
import union from "@turf/union";
import { featureCollection } from "@turf/helpers";
import type { FeatureCollection } from "geojson";
import type {
  RegionFeature,
  RegionGeometry,
  SurfaceProperties,
} from "../extensions/api";

export const DEFAULT_REGION_SIMPLIFY_THRESHOLD = 100;

export function simplifyRegionCollection(
  regions: ReadonlyArray<RegionFeature>,
  threshold = DEFAULT_REGION_SIMPLIFY_THRESHOLD,
): RegionFeature[] {
  if (regions.length <= threshold) return [...regions];

  const combined = union(featureCollection([...regions]));
  return combined ? [combined as RegionFeature] : [];
}

export function unionRegions(
  regions: ReadonlyArray<RegionFeature>,
): RegionFeature | undefined {
  if (regions.length === 0) return undefined;
  if (regions.length === 1) return regions[0];
  return union(featureCollection([...regions])) as RegionFeature | undefined;
}

export function clipSurfaceCollection(
  collection: FeatureCollection<RegionGeometry, SurfaceProperties>,
  regions: ReadonlyArray<RegionFeature>,
): FeatureCollection<RegionGeometry, SurfaceProperties> {
  const mask = unionRegions(regions);
  if (!mask) return collection;

  return {
    type: "FeatureCollection",
    features: collection.features.flatMap((feature) => {
      const clipped = intersect(
        featureCollection([feature, mask]),
      ) as RegionFeature | null;
      return clipped
        ? [
            {
              ...clipped,
              id: feature.id,
              properties: feature.properties,
            },
          ]
        : [];
    }),
  };
}

