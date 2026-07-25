import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import type {
  Feature,
  FeatureCollection,
  MultiPolygon,
  Point,
  Polygon,
} from "geojson";
import type {
  HeatmapStyle,
  HostedPoint,
  PointPredicate,
  PointProperties,
  RegionGeometry,
  SurfaceHeatmapData,
  SurfaceProperties,
} from "../extensions/api";

export interface NormalizedHeatmap {
  key: string;
  points: HostedPoint[];
}

export function normalizeSurfaceHeatmap(
  data: SurfaceHeatmapData,
): {
  collection: FeatureCollection<RegionGeometry, SurfaceProperties>;
  itemCount: number;
} {
  if (
    !data ||
    !Number.isInteger(data.itemCount) ||
    data.itemCount < 0 ||
    !data.collection ||
    data.collection.type !== "FeatureCollection"
  ) {
    throw new Error("Surface heatmap loader returned invalid data.");
  }
  const features = data.collection.features.map((feature, index) => {
    if (
      !feature ||
      feature.type !== "Feature" ||
      !["Polygon", "MultiPolygon"].includes(feature.geometry?.type) ||
      typeof feature.properties?.weight !== "number" ||
      !Number.isFinite(feature.properties.weight)
    ) {
      throw new Error(`Surface heatmap feature ${index + 1} is invalid.`);
    }
    return {
      ...feature,
      id: feature.id ?? `surface-${index}`,
      properties: {
        ...feature.properties,
        weight: Math.min(1, Math.max(0, feature.properties.weight)),
      },
    };
  });
  return {
    collection: { type: "FeatureCollection", features },
    itemCount: data.itemCount,
  };
}

function validPosition(coordinates: unknown): coordinates is [number, number] {
  return (
    Array.isArray(coordinates) &&
    coordinates.length >= 2 &&
    typeof coordinates[0] === "number" &&
    Number.isFinite(coordinates[0]) &&
    coordinates[0] >= -180 &&
    coordinates[0] <= 180 &&
    typeof coordinates[1] === "number" &&
    Number.isFinite(coordinates[1]) &&
    coordinates[1] >= -90 &&
    coordinates[1] <= 90
  );
}

export function normalizeHeatmapFeatures(
  collection: FeatureCollection<Point>,
  origin: HostedPoint["origin"],
  style: HeatmapStyle,
): HostedPoint[] {
  if (!collection || collection.type !== "FeatureCollection") {
    throw new Error("Heatmap loader must return a GeoJSON FeatureCollection.");
  }

  return collection.features.map((feature, index) => {
    if (
      !feature ||
      feature.type !== "Feature" ||
      feature.geometry?.type !== "Point" ||
      !validPosition(feature.geometry.coordinates)
    ) {
      throw new Error(`Heatmap feature ${index + 1} is not a valid point.`);
    }

    const inputProperties =
      feature.properties && typeof feature.properties === "object"
        ? feature.properties
        : {};
    const configuredWeight = style.weightProperty
      ? inputProperties[style.weightProperty]
      : inputProperties.weight;
    const weight =
      typeof configuredWeight === "number" && Number.isFinite(configuredWeight)
        ? configuredWeight
        : 1;
    const properties: PointProperties = { ...inputProperties, weight };

    return {
      feature: {
        ...feature,
        id: feature.id ?? `${origin.extensionId}/${origin.contributionId}/${index}`,
        geometry: {
          type: "Point",
          coordinates: [
            feature.geometry.coordinates[0],
            feature.geometry.coordinates[1],
          ],
        },
        properties,
      },
      origin,
    };
  });
}

export function pointMatchesRegions(
  point: HostedPoint,
  regions: ReadonlyArray<Feature<Polygon | MultiPolygon>>,
): boolean {
  if (regions.length === 0) return true;
  return regions.some((region) => booleanPointInPolygon(point.feature, region));
}

export function composePoints(
  points: ReadonlyArray<HostedPoint>,
  predicates: ReadonlyArray<PointPredicate>,
  regions: ReadonlyArray<Feature<Polygon | MultiPolygon>>,
): HostedPoint[] {
  return points.filter(
    (point) =>
      predicates.every((predicate) => predicate(point)) &&
      pointMatchesRegions(point, regions),
  );
}

export function groupPoints(
  points: ReadonlyArray<HostedPoint>,
): Map<string, FeatureCollection<Point, PointProperties>> {
  const groups = new Map<string, FeatureCollection<Point, PointProperties>>();

  for (const point of points) {
    const key = `${point.origin.extensionId}/${point.origin.contributionId}`;
    const group = groups.get(key) ?? {
      type: "FeatureCollection" as const,
      features: [],
    };
    group.features.push(point.feature);
    groups.set(key, group);
  }

  return groups;
}
