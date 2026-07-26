import circle from "@turf/circle";
import difference from "@turf/difference";
import union from "@turf/union";
import { feature, featureCollection, polygon } from "@turf/helpers";
import type {
  Feature,
  FeatureCollection,
  MultiPolygon,
  Polygon,
} from "geojson";
import {
  boundsIntersect,
  expandBoundsByMeters,
  type GeoBounds,
} from "./geo";
import { simplifyRegionCollection } from "./regions";
import type {
  RegionFeature,
  RegionGeometry,
  SurfaceProperties,
} from "../extensions/api";

export interface ProximityRecord {
  id: string;
  name?: string;
  center: [number, number];
  bbox?: GeoBounds;
}

function ring(west: number, south: number, east: number, north: number) {
  return [
    [west, south],
    [east, south],
    [east, north],
    [west, north],
    [west, south],
  ];
}

export function boundsPolygon(bounds: GeoBounds): RegionFeature {
  if (bounds.west <= bounds.east) {
    return polygon([ring(bounds.west, bounds.south, bounds.east, bounds.north)]);
  }
  return feature<MultiPolygon>({
    type: "MultiPolygon",
    coordinates: [
      [ring(bounds.west, bounds.south, 180, bounds.north)],
      [ring(-180, bounds.south, bounds.east, bounds.north)],
    ],
  });
}

function recordCore(record: ProximityRecord): RegionFeature {
  return record.bbox
    ? boundsPolygon(record.bbox)
    : circle(record.center, 20, { units: "meters", steps: 24 });
}

function recordContour(
  record: ProximityRecord,
  level: number,
): RegionFeature | undefined {
  if (!record.bbox) {
    const radius = 20 + (280 * level) / 12;
    return circle(record.center, radius, { units: "meters", steps: 24 });
  }
  if (level === 0) return recordCore(record);
  return boundsPolygon(expandBoundsByMeters(record.bbox, level * 25));
}

function combine(features: RegionFeature[]) {
  if (features.length === 0) return undefined;
  if (features.length === 1) return features[0];
  return union(featureCollection(features)) as RegionFeature | null;
}

function outerBounds(record: ProximityRecord) {
  const bounds =
    record.bbox ??
    ({
      west: record.center[0],
      south: record.center[1],
      east: record.center[0],
      north: record.center[1],
    } satisfies GeoBounds);
  return expandBoundsByMeters(bounds, 300);
}

function intersectingRecordClusters(records: ProximityRecord[]) {
  const parents = records.map((_, index) => index);
  const find = (index: number): number => {
    if (parents[index] !== index) parents[index] = find(parents[index]);
    return parents[index];
  };
  const bounds = records.map(outerBounds);

  for (let first = 0; first < records.length; first += 1) {
    for (let second = 0; second < first; second += 1) {
      if (!boundsIntersect(bounds[first], bounds[second])) continue;
      const firstRoot = find(first);
      const secondRoot = find(second);
      if (firstRoot !== secondRoot) parents[firstRoot] = secondRoot;
    }
  }

  const clusters = new Map<number, ProximityRecord[]>();
  records.forEach((record, index) => {
    const root = find(index);
    const cluster = clusters.get(root);
    if (cluster) cluster.push(record);
    else clusters.set(root, [record]);
  });
  return [...clusters.values()];
}

function combineDisjoint(features: RegionFeature[]) {
  if (features.length === 0) return undefined;
  if (features.length === 1) return features[0];
  return feature<MultiPolygon>({
    type: "MultiPolygon",
    coordinates: features.flatMap(({ geometry }) =>
      geometry.type === "Polygon"
        ? [geometry.coordinates]
        : geometry.coordinates,
    ),
  });
}

function subtractNestedCoverage(
  outer: RegionFeature,
  inner: RegionFeature,
): RegionFeature | undefined {
  if (
    outer.geometry.type === "Polygon" &&
    outer.geometry.coordinates.length === 1 &&
    inner.geometry.type === "Polygon" &&
    inner.geometry.coordinates.length === 1
  ) {
    return polygon([
      outer.geometry.coordinates[0],
      [...inner.geometry.coordinates[0]].reverse(),
    ]);
  }
  return (
    difference(featureCollection([outer, inner])) as
      | RegionFeature
      | null
      | undefined
  ) ?? undefined;
}

export function proximityFilterRegions(
  records: ProximityRecord[],
  distance: number,
  idProperty: string,
): { regions: RegionFeature[]; itemCount: number } {
  const regions = records.flatMap((record): RegionFeature[] => {
    if (record.bbox) {
      const expanded = expandBoundsByMeters(record.bbox, distance);
      return [
        {
          ...boundsPolygon(expanded),
          properties: {
            [idProperty]: record.id,
            name: record.name,
          },
        },
      ];
    }
    if (distance <= 0) return [];
    return [
      circle(record.center, distance, {
        units: "meters",
        steps: 48,
        properties: {
          [idProperty]: record.id,
          name: record.name,
        },
      }),
    ];
  });
  return {
    regions: simplifyRegionCollection(regions),
    itemCount: regions.length,
  };
}

export function proximityHeatContours(
  records: ProximityRecord[],
  featureIdPrefix: string,
): FeatureCollection<RegionGeometry, SurfaceProperties> {
  if (records.length === 0) {
    return { type: "FeatureCollection", features: [] };
  }

  const levelParts: RegionFeature[][] = Array.from(
    { length: 13 },
    () => [],
  );
  const clusters = intersectingRecordClusters(records);
  for (const cluster of clusters) {
    const coverages: RegionFeature[] = [];
    for (let level = 0; level <= 12; level += 1) {
      const contours = cluster
        .map((record) => recordContour(record, level))
        .filter((item): item is RegionFeature => !!item);
      const coverage = combine(contours);
      if (coverage) coverages.push(coverage);
    }
    if (coverages.length === 0) continue;
    levelParts[0].push(coverages[0]);
    for (let level = 1; level < coverages.length; level += 1) {
      const band = subtractNestedCoverage(
        coverages[level],
        coverages[level - 1],
      );
      if (band) levelParts[level].push(band);
    }
  }

  const features: Array<
    Feature<Polygon | MultiPolygon, SurfaceProperties>
  > = levelParts.flatMap((parts, level) => {
    const geometry = combineDisjoint(parts);
    if (!geometry) return [];
    return [
      {
        ...geometry,
        id:
          level === 0
            ? `${featureIdPrefix}-heat-core`
            : `${featureIdPrefix}-heat-band-${level}`,
        properties: {
          weight:
            level === 0 ? 1 : Math.max(0, 1 - (level - 0.5) / 12),
        },
      },
    ];
  });
  return featureCollection(features);
}
