import { featureCollection, polygon } from "@turf/helpers";
import { normalizeHeatmapFeatures, pointMatchesRegions } from "./composition";
import {
  areaOfInterestIsWithinLimit,
  clipSurfaceCollection,
  clipRegions,
  filterRegionComponentsByArea,
  intersectRegionGroups,
  MINIMUM_RESULT_REGION_AREA_SQUARE_METERS,
  regionBoundingBoxDimensionsMiles,
  regionViewport,
  simplifyRegionCollection,
} from "./regions";

function square(index: number) {
  const west = index * 0.01;
  return polygon([
    [
      [west, 0],
      [west + 0.02, 0],
      [west + 0.02, 0.02],
      [west, 0.02],
      [west, 0],
    ],
  ]);
}

function rectangle(west: number, south: number, east: number, north: number) {
  return polygon([
    [
      [west, south],
      [east, south],
      [east, north],
      [west, north],
      [west, south],
    ],
  ]);
}

describe("region collection simplification", () => {
  it("keeps small collections independent and unions large collections", () => {
    expect(simplifyRegionCollection([square(0), square(1)], 2)).toHaveLength(2);

    const simplified = simplifyRegionCollection(
      Array.from({ length: 101 }, (_, index) => square(index)),
    );
    expect(simplified).toHaveLength(1);

    const [point] = normalizeHeatmapFeatures(
      featureCollection([
        {
          type: "Feature",
          properties: {},
          geometry: { type: "Point", coordinates: [0.5, 0.01] },
        },
      ]),
      { extensionId: "test", contributionId: "points" },
      {},
    );
    expect(pointMatchesRegions(point, simplified)).toBe(true);
  });

  it("unions each source and intersects the resulting region groups", () => {
    const boundary = intersectRegionGroups([
      [square(0), square(3)],
      [square(1)],
    ]);
    expect(boundary).toBeDefined();

    const [inside, outside] = normalizeHeatmapFeatures(
      featureCollection([
        {
          type: "Feature",
          properties: {},
          geometry: { type: "Point", coordinates: [0.015, 0.01] },
        },
        {
          type: "Feature",
          properties: {},
          geometry: { type: "Point", coordinates: [0.005, 0.01] },
        },
      ]),
      { extensionId: "test", contributionId: "points" },
      {},
    );
    expect(pointMatchesRegions(inside, [boundary!])).toBe(true);
    expect(pointMatchesRegions(outside, [boundary!])).toBe(false);
    expect(intersectRegionGroups([[square(0)], [square(5)]])).toBeUndefined();
  });

  it("treats an empty region source as an empty AND constraint", () => {
    expect(intersectRegionGroups([[square(0)], []])).toBeUndefined();
  });

  it("removes result components at or below 100,000 square meters", () => {
    const large = rectangle(0, 0, 0.01, 0.01);
    const tiny = rectangle(0.02, 0, 0.021, 0.001);
    const combined = {
      type: "Feature" as const,
      properties: {},
      geometry: {
        type: "MultiPolygon" as const,
        coordinates: [
          large.geometry.coordinates,
          tiny.geometry.coordinates,
        ],
      },
    };

    const filtered = filterRegionComponentsByArea(combined);

    expect(MINIMUM_RESULT_REGION_AREA_SQUARE_METERS).toBe(100_000);
    expect(filtered?.geometry.type).toBe("Polygon");
    expect(filtered?.geometry.coordinates).toEqual(large.geometry.coordinates);
    expect(intersectRegionGroups([[tiny], [tiny]])).toBeUndefined();
    expect(intersectRegionGroups([[tiny], [tiny]], 0)).toBeDefined();
  });

  it("measures and validates the Area of Interest bounding box", () => {
    const withinLimit = rectangle(0, 0, 0.5, 0.5);
    const overLimit = rectangle(0, 0, 1, 0.25);

    expect(regionViewport(withinLimit)).toEqual({
      center: [0.25, 0.25],
      bounds: { west: 0, south: 0, east: 0.5, north: 0.5 },
    });
    expect(regionBoundingBoxDimensionsMiles(withinLimit).largest).toBeCloseTo(
      34.55,
      1,
    );
    expect(areaOfInterestIsWithinLimit(withinLimit)).toBe(true);
    expect(areaOfInterestIsWithinLimit(overLimit)).toBe(false);
  });

  it("rejects non-finite Area of Interest coordinates", () => {
    expect(() =>
      regionViewport({
        type: "Feature",
        properties: {},
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [Number.NaN, 0],
              [1, 0],
              [1, 1],
              [0, 1],
              [Number.NaN, 0],
            ],
          ],
        },
      }),
    ).toThrow("invalid coordinates");
  });

  it("clips filter-owned regions to the Area of Interest", () => {
    const clipped = clipRegions(
      [rectangle(-1, -1, 1, 1)],
      [rectangle(0, 0, 0.5, 0.5)],
    );

    expect(clipped).toHaveLength(1);
    expect(regionViewport(clipped[0]).bounds).toEqual({
      west: 0,
      south: 0,
      east: 0.5,
      north: 0.5,
    });
    expect(
      clipRegions(
        [rectangle(2, 2, 3, 3)],
        [rectangle(0, 0, 0.5, 0.5)],
      ),
    ).toEqual([]);
  });

  it("preserves exact contained surface geometry and caches the result", () => {
    const contained = {
      ...rectangle(1, 1, 2, 2),
      id: "contained",
      properties: { weight: 0.5 },
    };
    const crossing = {
      ...rectangle(-1, 4, 1, 6),
      id: "crossing",
      properties: { weight: 0.75 },
    };
    const outside = {
      ...rectangle(20, 20, 21, 21),
      id: "outside",
      properties: { weight: 1 },
    };
    const collection = featureCollection([contained, crossing, outside]);
    const mask = rectangle(0, 0, 10, 10);

    const first = clipSurfaceCollection(collection, [mask]);
    const second = clipSurfaceCollection(collection, [mask]);

    expect(second).toBe(first);
    expect(first.features).toHaveLength(2);
    expect(first.features[0]).toBe(contained);
    expect(first.features[0].geometry.coordinates).toBe(
      contained.geometry.coordinates,
    );
    expect(first.features[1].id).toBe("crossing");
    expect(first.features[1].properties).toBe(crossing.properties);
    expect(regionViewport(first.features[1]).bounds).toEqual({
      west: 0,
      south: 4,
      east: 1,
      north: 6,
    });
  });

  it("keeps every coordinate when a rectangular constraint contains a mask", () => {
    const detailed = polygon([
      [
        [1, 1],
        [2, 1],
        [2.5, 1.25],
        [3, 1],
        [4, 1],
        [4, 4],
        [1, 4],
        [1, 1],
      ],
      [
        [1.5, 1.5],
        [1.5, 2],
        [2, 2],
        [2, 1.5],
        [1.5, 1.5],
      ],
    ]);
    const boundary = intersectRegionGroups(
      [[rectangle(0, 0, 10, 10)], [detailed]],
      0,
    );

    expect(boundary?.geometry.type).toBe("Polygon");
    expect(boundary?.geometry.coordinates).toEqual(
      detailed.geometry.coordinates,
    );
  });
});
