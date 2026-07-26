import difference from "@turf/difference";
import { featureCollection } from "@turf/helpers";
import type {
  Feature,
  FeatureCollection,
  MultiPolygon,
  Polygon,
} from "geojson";
import type { IsochroneProperties } from "./server/commute";
import type {
  RegionFeature,
  RegionGeometry,
  SurfaceProperties,
} from "../api";

const CONTOUR_WEIGHTS = new Map([
  [15, 1],
  [20, 0.85],
  [25, 0.68],
  [35, 0.5],
  [40, 0.32],
  [45, 0.08],
]);

function commuteWeight(minutes: number) {
  return CONTOUR_WEIGHTS.get(minutes) ?? Math.max(0, 1 - minutes / 45);
}

export function commuteHeatSurface(
  collection: FeatureCollection<
    Polygon | MultiPolygon,
    IsochroneProperties
  >,
): FeatureCollection<RegionGeometry, SurfaceProperties> {
  const contours = [...collection.features].sort(
    (first, second) =>
      first.properties.minutes - second.properties.minutes,
  );
  const features: Array<
    Feature<Polygon | MultiPolygon, SurfaceProperties>
  > = [];

  contours.forEach((contour, index) => {
    const previous = contours[index - 1];
    const band = previous
      ? (difference(
          featureCollection([contour, previous]),
        ) as RegionFeature | null)
      : (contour as RegionFeature);
    if (!band) return;
    features.push({
      ...band,
      id: `commute-${contour.properties.minutes}-minutes`,
      properties: {
        weight: commuteWeight(contour.properties.minutes),
        minutes: contour.properties.minutes,
      },
    });
  });

  return { type: "FeatureCollection", features };
}
