import { multiPolygon, polygon } from "@turf/helpers";
import type { FeatureCollection } from "geojson";
import type { RegionGeometry } from "../api";
import {
  preparePolygonsForZillow,
  regionPolygons,
  zillowPreviewSurface,
  ZILLOW_MAX_POLYGONS,
  ZILLOW_MAX_POINTS_PER_POLYGON,
  ZILLOW_SUPER_REGION_INITIAL_GAP_MILES,
  ZILLOW_SUPER_REGION_MAX_GAP_MILES,
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

  it("connects close components into a super-region before applying the component limit", () => {
    const closeGapDegrees = ZILLOW_SUPER_REGION_INITIAL_GAP_MILES / 80;
    const polygons = [
      [
        [-84.3, 33.9],
        [-84.29, 33.9],
        [-84.29, 33.91],
        [-84.3, 33.91],
        [-84.3, 33.9],
      ],
      [
        [-84.29 + closeGapDegrees, 33.9],
        [-84.28 + closeGapDegrees, 33.9],
        [-84.28 + closeGapDegrees, 33.91],
        [-84.29 + closeGapDegrees, 33.91],
        [-84.29 + closeGapDegrees, 33.9],
      ],
    ] as [number, number][][];

    expect(preparePolygonsForZillow(polygons)).toHaveLength(1);
  });

  it("widens the connection gap when needed to retain the component budget", () => {
    const square = (longitude: number, latitude: number) =>
      [
        [longitude, latitude],
        [longitude + 0.005, latitude],
        [longitude + 0.005, latitude + 0.005],
        [longitude, latitude + 0.005],
        [longitude, latitude],
      ] as [number, number][];
    const adaptiveGapDegrees =
      (ZILLOW_SUPER_REGION_INITIAL_GAP_MILES + 0.2) / 57;
    const nearbyPair = [
      square(-84.4, 33.9),
      square(-84.395 + adaptiveGapDegrees, 33.9),
    ];
    const distantComponents = Array.from(
      { length: ZILLOW_MAX_POLYGONS - 1 },
      (_, index) => square(-84.2 + index * 0.04, 34.1),
    );

    const prepared = preparePolygonsForZillow([
      ...nearbyPair,
      ...distantComponents,
    ]);
    const widestComponent = Math.max(
      ...prepared.map((candidate) => {
        const longitudes = candidate.map(([longitude]) => longitude);
        return Math.max(...longitudes) - Math.min(...longitudes);
      }),
    );

    expect(prepared).toHaveLength(ZILLOW_MAX_POLYGONS);
    expect(widestComponent).toBeGreaterThan(0.01);
  });

  it("keeps components separate when their gap exceeds the super-region distance", () => {
    const farGapDegrees = ZILLOW_SUPER_REGION_MAX_GAP_MILES / 35;
    const polygons = [
      [
        [-84.3, 33.9],
        [-84.29, 33.9],
        [-84.29, 33.91],
        [-84.3, 33.91],
        [-84.3, 33.9],
      ],
      [
        [-84.29 + farGapDegrees, 33.9],
        [-84.28 + farGapDegrees, 33.9],
        [-84.28 + farGapDegrees, 33.91],
        [-84.29 + farGapDegrees, 33.91],
        [-84.29 + farGapDegrees, 33.9],
      ],
    ] as [number, number][][];

    expect(preparePolygonsForZillow(polygons)).toHaveLength(2);
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

  it("builds a weighted preview from the Zillow-simplified polygons", () => {
    const collection = {
      type: "FeatureCollection",
      features: [
        polygon([detailedCircle([-84.25, 33.98], 0.03, 1_000)]),
      ],
    } satisfies FeatureCollection<RegionGeometry>;

    const preview = zillowPreviewSurface(collection);
    const feature = preview.collection.features[0];

    expect(preview.itemCount).toBe(1);
    expect(feature.properties.weight).toBe(1);
    expect(feature.geometry.type).toBe("Polygon");
    if (feature.geometry.type === "Polygon") {
      expect(feature.geometry.coordinates[0].length).toBeLessThanOrEqual(
        ZILLOW_MAX_POINTS_PER_POLYGON,
      );
    }
  });
});
