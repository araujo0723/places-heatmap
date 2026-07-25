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
} from "../../core/geo";
import type { ParkRecord } from "../../core/parks";
import { simplifyRegionCollection } from "../../core/regions";
import type {
  RegionFeature,
  RegionGeometry,
  SurfaceProperties,
} from "../api";

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

function parkCore(park: ParkRecord): RegionFeature {
  return park.bbox
    ? boundsPolygon(park.bbox)
    : circle(park.center, 20, { units: "meters", steps: 24 });
}

function parkContour(park: ParkRecord, level: number): RegionFeature | undefined {
  if (!park.bbox) {
    const radius = 20 + (280 * level) / 12;
    return circle(park.center, radius, { units: "meters", steps: 24 });
  }
  if (level === 0) return parkCore(park);
  return boundsPolygon(expandBoundsByMeters(park.bbox, level * 25));
}

function combine(features: RegionFeature[]) {
  if (features.length === 0) return undefined;
  if (features.length === 1) return features[0];
  return union(featureCollection(features)) as RegionFeature | null;
}

function outerBounds(park: ParkRecord) {
  const bounds =
    park.bbox ??
    ({
      west: park.center[0],
      south: park.center[1],
      east: park.center[0],
      north: park.center[1],
    } satisfies GeoBounds);
  return expandBoundsByMeters(bounds, 300);
}

function intersectingParkClusters(parks: ParkRecord[]) {
  const parents = parks.map((_, index) => index);
  const find = (index: number): number => {
    if (parents[index] !== index) parents[index] = find(parents[index]);
    return parents[index];
  };
  const bounds = parks.map(outerBounds);

  for (let first = 0; first < parks.length; first += 1) {
    for (let second = 0; second < first; second += 1) {
      if (!boundsIntersect(bounds[first], bounds[second])) continue;
      const firstRoot = find(first);
      const secondRoot = find(second);
      if (firstRoot !== secondRoot) parents[firstRoot] = secondRoot;
    }
  }

  const clusters = new Map<number, ParkRecord[]>();
  parks.forEach((park, index) => {
    const root = find(index);
    const cluster = clusters.get(root);
    if (cluster) cluster.push(park);
    else clusters.set(root, [park]);
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

export function parkFilterRegions(
  parks: ParkRecord[],
  distance: number,
): { regions: RegionFeature[]; itemCount: number } {
  const regions = parks.flatMap((park): RegionFeature[] => {
    if (park.bbox) {
      const expanded = expandBoundsByMeters(park.bbox, distance);
      return [
        {
          ...boundsPolygon(expanded),
          properties: { parkId: park.id, name: park.name },
        },
      ];
    }
    if (distance <= 0) return [];
    return [
      circle(park.center, distance, {
        units: "meters",
        steps: 48,
        properties: { parkId: park.id, name: park.name },
      }),
    ];
  });
  return {
    regions: simplifyRegionCollection(regions),
    itemCount: regions.length,
  };
}

export function parkHeatContours(
  parks: ParkRecord[],
): FeatureCollection<RegionGeometry, SurfaceProperties> {
  if (parks.length === 0) {
    return { type: "FeatureCollection", features: [] };
  }

  const levelParts: RegionFeature[][] = Array.from(
    { length: 13 },
    () => [],
  );
  const clusters = intersectingParkClusters(parks);
  for (const cluster of clusters) {
    const coverages: RegionFeature[] = [];
    for (let level = 0; level <= 12; level += 1) {
      const contours = cluster
        .map((park) => parkContour(park, level))
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
        id: level === 0 ? "park-heat-core" : `park-heat-band-${level}`,
        properties: {
          weight:
            level === 0 ? 1 : Math.max(0, 1 - (level - 0.5) / 12),
        },
      },
    ];
  });
  return featureCollection(features);
}
