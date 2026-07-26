import area from "@turf/area";
import intersect from "@turf/intersect";
import union from "@turf/union";
import { featureCollection } from "@turf/helpers";
import type { FeatureCollection } from "geojson";
import type {
  MapViewport,
  RegionFeature,
  RegionGeometry,
  SurfaceProperties,
} from "../extensions/api";

export const DEFAULT_REGION_SIMPLIFY_THRESHOLD = 100;
export const MINIMUM_RESULT_REGION_AREA_SQUARE_METERS = 100_000;
export const MAX_AREA_OF_INTEREST_DIMENSION_MILES = 50;
const EARTH_RADIUS_MILES = 3_958.7613;

function polygonPositions(region: RegionFeature): Array<[number, number]> {
  const polygons =
    region.geometry.type === "Polygon"
      ? [region.geometry.coordinates]
      : region.geometry.coordinates;
  return polygons.flatMap((polygon) =>
    polygon.flatMap((ring) =>
      ring.map(([longitude, latitude]) => [longitude, latitude]),
    ),
  ) as Array<[number, number]>;
}

function distanceMiles(
  [firstLongitude, firstLatitude]: [number, number],
  [secondLongitude, secondLatitude]: [number, number],
) {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const latitudeDelta = radians(secondLatitude - firstLatitude);
  const longitudeDelta = radians(secondLongitude - firstLongitude);
  const firstLatitudeRadians = radians(firstLatitude);
  const secondLatitudeRadians = radians(secondLatitude);
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(firstLatitudeRadians) *
      Math.cos(secondLatitudeRadians) *
      Math.sin(longitudeDelta / 2) ** 2;
  return (
    2 *
    EARTH_RADIUS_MILES *
    Math.asin(Math.min(1, Math.sqrt(haversine)))
  );
}

export function regionViewport(region: RegionFeature): MapViewport {
  const positions = polygonPositions(region);
  if (positions.length === 0) {
    throw new Error("Area of Interest has no coordinates.");
  }
  const longitudes = positions.map(([longitude]) => longitude);
  const latitudes = positions.map(([, latitude]) => latitude);
  const west = Math.min(...longitudes);
  const south = Math.min(...latitudes);
  const east = Math.max(...longitudes);
  const north = Math.max(...latitudes);
  return {
    center: [(west + east) / 2, (south + north) / 2],
    bounds: { west, south, east, north },
  };
}

export function regionBoundingBoxDimensionsMiles(region: RegionFeature) {
  const { bounds } = regionViewport(region);
  const width = Math.max(
    distanceMiles(
      [bounds.west, bounds.south],
      [bounds.east, bounds.south],
    ),
    distanceMiles(
      [bounds.west, bounds.north],
      [bounds.east, bounds.north],
    ),
  );
  const height = distanceMiles(
    [bounds.west, bounds.south],
    [bounds.west, bounds.north],
  );
  return { width, height, largest: Math.max(width, height) };
}

export function areaOfInterestIsWithinLimit(region: RegionFeature) {
  return (
    regionBoundingBoxDimensionsMiles(region).largest <=
    MAX_AREA_OF_INTEREST_DIMENSION_MILES
  );
}

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

export function filterRegionComponentsByArea(
  region: RegionFeature,
  minimumAreaSquareMeters = MINIMUM_RESULT_REGION_AREA_SQUARE_METERS,
): RegionFeature | undefined {
  if (minimumAreaSquareMeters <= 0) return region;

  const polygons =
    region.geometry.type === "Polygon"
      ? [region.geometry.coordinates]
      : region.geometry.coordinates;
  const retained = polygons.filter(
    (coordinates) =>
      area({
        type: "Feature",
        properties: {},
        geometry: { type: "Polygon", coordinates },
      }) > minimumAreaSquareMeters,
  );

  if (retained.length === 0) return undefined;
  return {
    ...region,
    geometry:
      retained.length === 1
        ? { type: "Polygon", coordinates: retained[0] }
        : { type: "MultiPolygon", coordinates: retained },
  };
}

export function intersectRegionGroups(
  groups: ReadonlyArray<ReadonlyArray<RegionFeature>>,
  minimumAreaSquareMeters = MINIMUM_RESULT_REGION_AREA_SQUARE_METERS,
): RegionFeature | undefined {
  if (groups.length === 0) return undefined;
  const masks: RegionFeature[] = [];
  for (const regions of groups) {
    const mask = unionRegions(regions);
    if (!mask) return undefined;
    masks.push(mask);
  }

  const intersection = masks
    .slice(1)
    .reduce<RegionFeature | undefined>((result, mask) => {
      if (!result) return undefined;
      return (
        (intersect(
          featureCollection([result, mask]),
        ) as RegionFeature | null) ?? undefined
      );
    }, masks[0]);

  return intersection
    ? filterRegionComponentsByArea(intersection, minimumAreaSquareMeters)
    : undefined;
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

export function clipRegions(
  regions: ReadonlyArray<RegionFeature>,
  masks: ReadonlyArray<RegionFeature>,
): RegionFeature[] {
  const mask = unionRegions(masks);
  if (!mask) return [...regions];

  return regions.flatMap((feature) => {
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
  });
}
