import { multiPolygon, polygon } from "@turf/helpers";
import type { FeatureCollection } from "geojson";
import type { RegionGeometry } from "../api";
import {
  preparePolygonsForZillow,
  regionPolygons,
  ZILLOW_MAX_POLYGONS,
  ZILLOW_MAX_POINTS_PER_POLYGON,
  ZILLOW_MAX_TOTAL_POINTS,
} from "./geometry";
import { buildZillowCustomRegionPolygon } from "./zillow";

function detailedCircle(
  center: [number, number],
  radius: number,
  vertices: number,
) {
  const ring = Array.from({ length: vertices }, (_, index) => {
    const angle = (index / vertices) * Math.PI * 2;
    return [
      center[0] + Math.cos(angle) * radius,
      center[1] + Math.sin(angle) * radius,
    ] as [number, number];
  });
  return [...ring, ring[0]];
}

describe("Zillow region geometry", () => {
  it("simplifies a detailed boundary below both vertex budgets", () => {
    const polygons = preparePolygonsForZillow([
      detailedCircle([-84.25, 33.98], 0.03, 1_000),
      detailedCircle([-84.16, 34.02], 0.01, 500),
    ]);
    const serializedPointCount = polygons.reduce(
      (count, candidate) => count + candidate.length,
      0,
    );

    expect(serializedPointCount).toBeLessThanOrEqual(ZILLOW_MAX_TOTAL_POINTS);
    expect(
      Math.max(...polygons.map((candidate) => candidate.length)),
    ).toBeLessThanOrEqual(ZILLOW_MAX_POINTS_PER_POLYGON);
    expect(buildZillowCustomRegionPolygon(polygons).length).toBeLessThan(7_000);
  });

  it("keeps only the largest components when a boundary is fragmented", () => {
    const polygons = Array.from({ length: 20 }, (_, index) => {
      const size = (index + 1) / 10_000;
      return [
        [index * 0.01, 0],
        [index * 0.01 + size, 0],
        [index * 0.01 + size, size],
        [index * 0.01, size],
        [index * 0.01, 0],
      ] as [number, number][];
    });
    const prepared = preparePolygonsForZillow(polygons);

    expect(prepared).toHaveLength(ZILLOW_MAX_POLYGONS);
    expect(prepared[0][1][0] - prepared[0][0][0]).toBeCloseTo(0.002);
  });

  it("extracts outer rings from polygon and multipolygon features", () => {
    const collection = {
      type: "FeatureCollection",
      features: [
        polygon([
          [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 1],
            [0, 0],
          ],
        ]),
        multiPolygon([
          [
            [
              [2, 0],
              [3, 0],
              [3, 1],
              [2, 1],
              [2, 0],
            ],
          ],
          [
            [
              [4, 0],
              [5, 0],
              [5, 1],
              [4, 1],
              [4, 0],
            ],
          ],
        ]),
      ],
    } satisfies FeatureCollection<RegionGeometry>;

    expect(regionPolygons(collection)).toHaveLength(3);
  });
});
