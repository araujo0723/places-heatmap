import { featureCollection, polygon } from "@turf/helpers";
import { normalizeHeatmapFeatures, pointMatchesRegions } from "./composition";
import {
  areaOfInterestIsWithinLimit,
  clipRegions,
  intersectRegionGroups,
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
});
