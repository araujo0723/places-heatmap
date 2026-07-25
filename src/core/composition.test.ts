import type { Feature, FeatureCollection, Point, Polygon } from "geojson";
import {
  composePoints,
  groupPoints,
  normalizeHeatmapFeatures,
  pointMatchesRegions,
} from "./composition";

function collection(
  features: FeatureCollection<Point>["features"],
): FeatureCollection<Point> {
  return { type: "FeatureCollection", features };
}

function point(
  id: string,
  coordinates: [number, number],
  properties: Record<string, unknown> = {},
): Feature<Point> {
  return {
    type: "Feature",
    id,
    geometry: { type: "Point", coordinates },
    properties,
  };
}

function square(
  west: number,
  south: number,
  east: number,
  north: number,
): Feature<Polygon> {
  return {
    type: "Feature",
    properties: {},
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [west, south],
          [east, south],
          [east, north],
          [west, north],
          [west, south],
        ],
      ],
    },
  };
}

describe("heatmap composition", () => {
  it("normalizes configured weights and supplies stable defaults", () => {
    const normalized = normalizeHeatmapFeatures(
      collection([
        point("weighted", [0, 0], { score: 7 }),
        point("default", [1, 1], { score: "high" }),
      ]),
      { extensionId: "demo", contributionId: "density" },
      { weightProperty: "score" },
    );

    expect(normalized).toHaveLength(2);
    expect(normalized[0].feature.properties.weight).toBe(7);
    expect(normalized[1].feature.properties.weight).toBe(1);
    expect(normalized[0].origin).toEqual({
      extensionId: "demo",
      contributionId: "density",
    });
  });

  it("rejects invalid point geometries", () => {
    expect(() =>
      normalizeHeatmapFeatures(
        collection([point("invalid", [181, 0])]),
        { extensionId: "demo", contributionId: "density" },
        {},
      ),
    ).toThrow("not a valid point");
  });

  it("uses a union for regions and AND across predicates", () => {
    const points = normalizeHeatmapFeatures(
      collection([
        point("west", [-5, 0], { weight: 8 }),
        point("center", [0, 0], { weight: 4 }),
        point("east", [5, 0], { weight: 9 }),
        point("outside", [20, 0], { weight: 10 }),
      ]),
      { extensionId: "demo", contributionId: "density" },
      {},
    );
    const regions = [square(-6, -1, -4, 1), square(4, -1, 6, 1)];
    const predicates = [
      (candidate: (typeof points)[number]) =>
        candidate.feature.properties.weight >= 8,
      (candidate: (typeof points)[number]) =>
        candidate.feature.id !== "east",
    ];

    expect(pointMatchesRegions(points[0], regions)).toBe(true);
    expect(pointMatchesRegions(points[3], regions)).toBe(false);
    expect(composePoints(points, predicates, regions).map((item) => item.feature.id))
      .toEqual(["west"]);
  });

  it("treats no regions and no predicates as neutral constraints", () => {
    const points = normalizeHeatmapFeatures(
      collection([point("one", [0, 0])]),
      { extensionId: "demo", contributionId: "density" },
      {},
    );

    expect(composePoints(points, [], [])).toEqual(points);
  });

  it("groups surviving points by their heatmap origin", () => {
    const first = normalizeHeatmapFeatures(
      collection([point("one", [0, 0])]),
      { extensionId: "alpha", contributionId: "density" },
      {},
    );
    const second = normalizeHeatmapFeatures(
      collection([point("two", [1, 1]), point("three", [2, 2])]),
      { extensionId: "beta", contributionId: "visits" },
      {},
    );

    const groups = groupPoints([...first, ...second]);

    expect(groups.get("alpha/density")?.features).toHaveLength(1);
    expect(groups.get("beta/visits")?.features).toHaveLength(2);
  });
});

