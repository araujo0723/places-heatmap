import { featureCollection, polygon } from "@turf/helpers";
import { normalizeHeatmapFeatures, pointMatchesRegions } from "./composition";
import {
  intersectRegionGroups,
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
});
