import type { IncomeCollection } from "./income";
import {
  filterIncomeRegions,
  incomeHeatSurface,
  incomeWeight,
} from "./income";

function square(west: number, income: number): IncomeCollection["features"][number] {
  return {
    type: "Feature",
    properties: {
      geoid: `13001000000${west}`,
      name: `Block group ${west}`,
      income,
      weight: incomeWeight(income),
    },
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [west, 0],
          [west + 1, 0],
          [west + 1, 1],
          [west, 1],
          [west, 0],
        ],
      ],
    },
  };
}

describe("median household income geometry", () => {
  const collection: IncomeCollection = {
    type: "FeatureCollection",
    features: [square(0, 25_000), square(2, 100_000)],
  };

  it("normalizes income against the $300,000 scale", () => {
    expect(incomeWeight(0)).toBe(0);
    expect(incomeWeight(150_000)).toBe(0.5);
    expect(incomeWeight(400_000)).toBe(1);
  });

  it("combines qualifying block groups into one filter mask", () => {
    const result = filterIncomeRegions(collection, 50_000);

    expect(result.itemCount).toBe(1);
    expect(result.collection.features).toHaveLength(1);
    expect(result.collection.features[0].geometry.type).toBe("MultiPolygon");
    expect(
      result.collection.features[0].geometry.type === "MultiPolygon"
        ? result.collection.features[0].geometry.coordinates
        : [],
    ).toHaveLength(1);
  });

  it("returns an empty constraint when no block group qualifies", () => {
    expect(filterIncomeRegions(collection, 300_000)).toEqual({
      collection: { type: "FeatureCollection", features: [] },
      itemCount: 0,
    });
  });

  it("preserves each block group's normalized heatmap weight", () => {
    const surface = incomeHeatSurface(collection);
    expect(surface.features.map(({ properties }) => properties.weight)).toEqual([
      25_000 / 300_000,
      100_000 / 300_000,
    ]);
  });
});
