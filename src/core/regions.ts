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

interface RegionBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

const geometryBoundsCache = new WeakMap<RegionGeometry, RegionBounds>();
const singleMaskClipCache = new WeakMap<
  FeatureCollection<RegionGeometry, SurfaceProperties>,
  WeakMap<
    RegionFeature,
    FeatureCollection<RegionGeometry, SurfaceProperties>
  >
>();

function geometryBounds(geometry: RegionGeometry): RegionBounds | undefined {
  const cached = geometryBoundsCache.get(geometry);
  if (cached) return cached;

  let west = Number.POSITIVE_INFINITY;
  let south = Number.POSITIVE_INFINITY;
  let east = Number.NEGATIVE_INFINITY;
  let north = Number.NEGATIVE_INFINITY;
  const polygons =
    geometry.type === "Polygon"
      ? [geometry.coordinates]
      : geometry.coordinates;

  for (const polygon of polygons) {
    for (const ring of polygon) {
      for (const position of ring) {
        const [longitude, latitude] = position;
        if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
          return undefined;
        }
        west = Math.min(west, longitude);
        south = Math.min(south, latitude);
        east = Math.max(east, longitude);
        north = Math.max(north, latitude);
      }
    }
  }

  if (
    !Number.isFinite(west) ||
    !Number.isFinite(south) ||
    !Number.isFinite(east) ||
    !Number.isFinite(north)
  ) {
    return undefined;
  }

  const bounds = { west, south, east, north };
  geometryBoundsCache.set(geometry, bounds);
  return bounds;
}

function boundsHavePositiveOverlap(
  first: RegionBounds,
  second: RegionBounds,
) {
  return !(
    first.east <= second.west ||
    first.west >= second.east ||
    first.north <= second.south ||
    first.south >= second.north
  );
}

function boundsContain(container: RegionBounds, contained: RegionBounds) {
  return (
    contained.west >= container.west &&
    contained.south >= container.south &&
    contained.east <= container.east &&
    contained.north <= container.north
  );
}

function rectangleBounds(region: RegionFeature): RegionBounds | undefined {
  if (
    region.geometry.type !== "Polygon" ||
    region.geometry.coordinates.length !== 1
  ) {
    return undefined;
  }
  const ring = region.geometry.coordinates[0];
  if (
    ring.length !== 5 ||
    ring[0][0] !== ring[4][0] ||
    ring[0][1] !== ring[4][1]
  ) {
    return undefined;
  }
  const bounds = geometryBounds(region.geometry);
  if (!bounds) return undefined;

  const expectedCorners = new Set([
    `${bounds.west},${bounds.south}`,
    `${bounds.west},${bounds.north}`,
    `${bounds.east},${bounds.south}`,
    `${bounds.east},${bounds.north}`,
  ]);
  const actualCorners = new Set(
    ring.slice(0, -1).map(([longitude, latitude]) => {
      return `${longitude},${latitude}`;
    }),
  );
  if (
    actualCorners.size !== 4 ||
    [...actualCorners].some((corner) => !expectedCorners.has(corner))
  ) {
    return undefined;
  }
  for (let index = 0; index < ring.length - 1; index += 1) {
    const current = ring[index];
    const next = ring[index + 1];
    if (current[0] !== next[0] && current[1] !== next[1]) return undefined;
  }
  return bounds;
}

type FastIntersection =
  | { handled: false }
  | { handled: true; feature: RegionFeature | undefined };

function fastIntersection(
  first: RegionFeature,
  second: RegionFeature,
): FastIntersection {
  const firstBounds = geometryBounds(first.geometry);
  const secondBounds = geometryBounds(second.geometry);
  if (!firstBounds || !secondBounds) return { handled: false };
  if (!boundsHavePositiveOverlap(firstBounds, secondBounds)) {
    return { handled: true, feature: undefined };
  }

  const firstRectangle = rectangleBounds(first);
  if (firstRectangle && boundsContain(firstRectangle, secondBounds)) {
    return {
      handled: true,
      feature: {
        type: "Feature",
        properties: {},
        geometry: second.geometry,
      },
    };
  }
  const secondRectangle = rectangleBounds(second);
  if (secondRectangle && boundsContain(secondRectangle, firstBounds)) {
    return {
      handled: true,
      feature: {
        type: "Feature",
        properties: {},
        geometry: first.geometry,
      },
    };
  }
  return { handled: false };
}

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
  if (
    positions.length === 0 ||
    positions.some(
      ([longitude, latitude]) =>
        !Number.isFinite(longitude) ||
        longitude < -180 ||
        longitude > 180 ||
        !Number.isFinite(latitude) ||
        latitude < -90 ||
        latitude > 90,
    )
  ) {
    throw new Error("Area of Interest has invalid coordinates.");
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
      const fast = fastIntersection(result, mask);
      if (fast.handled) return fast.feature;
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
  const singleMask = regions.length === 1 ? regions[0] : undefined;
  if (singleMask) {
    const cached = singleMaskClipCache.get(collection)?.get(singleMask);
    if (cached) return cached;
  }

  const mask = unionRegions(regions);
  if (!mask) return collection;

  const clippedCollection: FeatureCollection<
    RegionGeometry,
    SurfaceProperties
  > = {
    type: "FeatureCollection",
    features: collection.features.flatMap((feature) => {
      const fast = fastIntersection(feature, mask);
      if (fast.handled) {
        if (!fast.feature) return [];
        if (fast.feature.geometry === feature.geometry) return [feature];
        return [
          {
            ...fast.feature,
            id: feature.id,
            properties: feature.properties,
          },
        ];
      }
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
  if (singleMask) {
    let maskCache = singleMaskClipCache.get(collection);
    if (!maskCache) {
      maskCache = new WeakMap();
      singleMaskClipCache.set(collection, maskCache);
    }
    maskCache.set(singleMask, clippedCollection);
  }
  return clippedCollection;
}

export function clipRegions(
  regions: ReadonlyArray<RegionFeature>,
  masks: ReadonlyArray<RegionFeature>,
): RegionFeature[] {
  const mask = unionRegions(masks);
  if (!mask) return [...regions];

  return regions.flatMap((feature) => {
    const fast = fastIntersection(feature, mask);
    if (fast.handled) {
      if (!fast.feature) return [];
      if (fast.feature.geometry === feature.geometry) return [feature];
      return [
        {
          ...fast.feature,
          id: feature.id,
          properties: feature.properties,
        },
      ];
    }
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
