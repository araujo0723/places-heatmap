import type { FeatureCollection } from "geojson";
import type { RegionGeometry } from "../api";

export type ZillowCoordinate = [number, number];
export type ZillowPolygon = ZillowCoordinate[];

export const ZILLOW_MAX_POLYGONS = 8;
export const ZILLOW_MAX_TOTAL_POINTS = 96;
export const ZILLOW_MAX_POINTS_PER_POLYGON = 48;

const MIN_SIMPLIFICATION_TOLERANCE = 0.00025;
const MAX_SIMPLIFICATION_TOLERANCE = 0.01;
const SIMPLIFICATION_SCALE_FACTOR = 0.015;

function sameCoordinate(
  left: ZillowCoordinate,
  right: ZillowCoordinate,
) {
  return left[0] === right[0] && left[1] === right[1];
}

function openPolygon(polygon: ReadonlyArray<ZillowCoordinate>) {
  const coordinates = polygon.filter(
    (coordinate): coordinate is ZillowCoordinate =>
      Array.isArray(coordinate) &&
      Number.isFinite(coordinate[0]) &&
      Number.isFinite(coordinate[1]) &&
      coordinate[0] >= -180 &&
      coordinate[0] <= 180 &&
      coordinate[1] >= -90 &&
      coordinate[1] <= 90,
  );
  const open =
    coordinates.length > 1 &&
    sameCoordinate(coordinates[0], coordinates[coordinates.length - 1])
      ? coordinates.slice(0, -1)
      : coordinates.slice();

  return open.filter(
    (coordinate, index) =>
      index === 0 || !sameCoordinate(coordinate, open[index - 1]),
  );
}

function closePolygon(polygon: ReadonlyArray<ZillowCoordinate>) {
  const open = openPolygon(polygon);
  return open.length >= 3 ? [...open, open[0]] : [];
}

function squaredDistance(
  left: ZillowCoordinate,
  right: ZillowCoordinate,
) {
  const longitude = left[0] - right[0];
  const latitude = left[1] - right[1];
  return longitude * longitude + latitude * latitude;
}

function perpendicularDistance(
  point: ZillowCoordinate,
  start: ZillowCoordinate,
  end: ZillowCoordinate,
) {
  const longitude = end[0] - start[0];
  const latitude = end[1] - start[1];
  const lengthSquared = longitude * longitude + latitude * latitude;
  if (lengthSquared === 0) return Math.sqrt(squaredDistance(point, start));

  const projection = Math.max(
    0,
    Math.min(
      1,
      ((point[0] - start[0]) * longitude +
        (point[1] - start[1]) * latitude) /
        lengthSquared,
    ),
  );
  return Math.hypot(
    point[0] - (start[0] + longitude * projection),
    point[1] - (start[1] + latitude * projection),
  );
}

function simplifyPath(
  points: ReadonlyArray<ZillowCoordinate>,
  tolerance: number,
) {
  if (points.length <= 2) return [...points];

  const keep = new Array(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;
  const pending: Array<[number, number]> = [[0, points.length - 1]];

  while (pending.length > 0) {
    const [startIndex, endIndex] = pending.pop() as [number, number];
    let furthestIndex = -1;
    let furthestDistance = tolerance;

    for (let index = startIndex + 1; index < endIndex; index += 1) {
      const distance = perpendicularDistance(
        points[index],
        points[startIndex],
        points[endIndex],
      );
      if (distance > furthestDistance) {
        furthestDistance = distance;
        furthestIndex = index;
      }
    }

    if (furthestIndex >= 0) {
      keep[furthestIndex] = true;
      pending.push([startIndex, furthestIndex], [furthestIndex, endIndex]);
    }
  }

  return points.filter((_, index) => keep[index]);
}

function circularPath(
  points: ReadonlyArray<ZillowCoordinate>,
  start: number,
  end: number,
) {
  const path: ZillowCoordinate[] = [];
  for (let index = start; ; index = (index + 1) % points.length) {
    path.push(points[index]);
    if (index === end) return path;
  }
}

function simplificationTolerance(points: ReadonlyArray<ZillowCoordinate>) {
  const longitudes = points.map(([longitude]) => longitude);
  const latitudes = points.map(([, latitude]) => latitude);
  const scale = Math.max(
    Math.max(...longitudes) - Math.min(...longitudes),
    Math.max(...latitudes) - Math.min(...latitudes),
  );
  return Math.min(
    MAX_SIMPLIFICATION_TOLERANCE,
    Math.max(
      MIN_SIMPLIFICATION_TOLERANCE,
      scale * SIMPLIFICATION_SCALE_FACTOR,
    ),
  );
}

function simplifyClosedPolygon(points: ReadonlyArray<ZillowCoordinate>) {
  if (points.length <= 4) return [...points];

  const extremeIndexes = [0, 1, 2, 3].map((axis) => {
    let selected = 0;
    for (let index = 1; index < points.length; index += 1) {
      const coordinate = axis < 2 ? points[index][0] : points[index][1];
      const current = axis < 2 ? points[selected][0] : points[selected][1];
      if (
        (axis % 2 === 0 && coordinate < current) ||
        (axis % 2 === 1 && coordinate > current)
      ) {
        selected = index;
      }
    }
    return selected;
  });

  let start = extremeIndexes[0];
  let end = extremeIndexes[1];
  let distance = -1;
  for (const left of extremeIndexes) {
    for (const right of extremeIndexes) {
      const candidate = squaredDistance(points[left], points[right]);
      if (candidate > distance) {
        start = left;
        end = right;
        distance = candidate;
      }
    }
  }

  const tolerance = simplificationTolerance(points);
  const forward = simplifyPath(circularPath(points, start, end), tolerance);
  const backward = simplifyPath(circularPath(points, end, start), tolerance);
  const simplified = [...forward.slice(0, -1), ...backward.slice(0, -1)];
  return simplified.length >= 3 ? simplified : [...points];
}

function triangleArea(
  previous: ZillowCoordinate,
  current: ZillowCoordinate,
  next: ZillowCoordinate,
) {
  return Math.abs(
    (previous[0] * (current[1] - next[1]) +
      current[0] * (next[1] - previous[1]) +
      next[0] * (previous[1] - current[1])) /
      2,
  );
}

function capVertices(
  polygon: ReadonlyArray<ZillowCoordinate>,
  maximum: number,
) {
  const points = [...polygon];
  while (points.length > Math.max(3, maximum)) {
    let smallestArea = Number.POSITIVE_INFINITY;
    let smallestIndex = 0;
    for (let index = 0; index < points.length; index += 1) {
      const area = triangleArea(
        points[(index + points.length - 1) % points.length],
        points[index],
        points[(index + 1) % points.length],
      );
      if (area < smallestArea) {
        smallestArea = area;
        smallestIndex = index;
      }
    }
    points.splice(smallestIndex, 1);
  }
  return points;
}

function polygonArea(polygon: ReadonlyArray<ZillowCoordinate>) {
  return Math.abs(
    polygon.reduce((area, point, index) => {
      const next = polygon[(index + 1) % polygon.length];
      return area + point[0] * next[1] - next[0] * point[1];
    }, 0) / 2,
  );
}

function allocateVertexBudgets(
  polygons: ReadonlyArray<ReadonlyArray<ZillowCoordinate>>,
) {
  const budgets = polygons.map(() => 3);
  const weights = polygons.map((polygon) => Math.sqrt(polygonArea(polygon)));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const availableOpenVertices =
    ZILLOW_MAX_TOTAL_POINTS - polygons.length;
  let remaining = availableOpenVertices - budgets.length * 3;

  if (totalWeight > 0) {
    for (let index = 0; index < polygons.length; index += 1) {
      const allocation = Math.min(
        polygons[index].length - 3,
        ZILLOW_MAX_POINTS_PER_POLYGON - 4,
        Math.floor(
          (weights[index] / totalWeight) *
            (availableOpenVertices - polygons.length * 3),
        ),
      );
      budgets[index] += allocation;
      remaining -= allocation;
    }
  }

  while (remaining > 0) {
    const index = budgets.findIndex(
      (budget, candidate) =>
        budget <
        Math.min(
          polygons[candidate].length,
          ZILLOW_MAX_POINTS_PER_POLYGON - 1,
        ),
    );
    if (index < 0) break;
    budgets[index] += 1;
    remaining -= 1;
  }
  return budgets;
}

export function preparePolygonsForZillow(
  polygons: ReadonlyArray<ReadonlyArray<ZillowCoordinate>>,
) {
  const candidates = polygons
    .map((polygon) => openPolygon(polygon))
    .filter((polygon) => polygon.length >= 3 && polygonArea(polygon) > 0)
    .map((polygon) =>
      capVertices(
        simplifyClosedPolygon(polygon),
        ZILLOW_MAX_POINTS_PER_POLYGON - 1,
      ),
    )
    .sort((left, right) => polygonArea(right) - polygonArea(left))
    .slice(0, ZILLOW_MAX_POLYGONS);
  const budgets = allocateVertexBudgets(candidates);

  return candidates
    .map((polygon, index) => closePolygon(capVertices(polygon, budgets[index])))
    .filter((polygon) => polygon.length >= 4);
}

export function regionPolygons(
  collection: FeatureCollection<RegionGeometry>,
) {
  const polygons = collection.features.flatMap(({ geometry }) =>
    geometry.type === "Polygon"
      ? [geometry.coordinates[0]]
      : geometry.coordinates.map((polygon) => polygon[0]),
  ) as ZillowPolygon[];
  return preparePolygonsForZillow(polygons);
}
