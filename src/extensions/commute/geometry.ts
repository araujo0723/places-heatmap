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

const LAYER_WEIGHTS = new Map([
  [20, 1],
  [40, 0],
]);

export function commuteHeatSurface(
  collection: FeatureCollection<
    Polygon | MultiPolygon,
    IsochroneProperties
  >,
): FeatureCollection<RegionGeometry, SurfaceProperties> {
  const contours = collection.features
    .filter(({ properties }) => LAYER_WEIGHTS.has(properties.minutes))
    .sort(
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
        weight: LAYER_WEIGHTS.get(contour.properties.minutes)!,
        minutes: contour.properties.minutes,
      },
    });
  });

  return { type: "FeatureCollection", features };
}
