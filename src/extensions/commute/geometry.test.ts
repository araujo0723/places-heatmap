import type { FeatureCollection, Polygon } from "geojson";
import type { IsochroneProperties } from "./server/commute";
import { commuteHeatSurface } from "./geometry";

function square(size: number, minutes: number) {
  return {
    type: "Feature" as const,
    geometry: {
      type: "Polygon" as const,
      coordinates: [
        [
          [-size, -size],
          [size, -size],
          [size, size],
          [-size, size],
          [-size, -size],
        ],
      ],
    },
    properties: { minutes },
  };
}

describe("commute heat geometry", () => {
  it("creates solid, non-overlapping 0–20 and 20–40 minute layers", () => {
    const contours: FeatureCollection<Polygon, IsochroneProperties> = {
      type: "FeatureCollection",
      features: [square(2, 20), square(4, 45), square(3, 40)],
    };

    const surface = commuteHeatSurface(contours);

    expect(surface.features.map((feature) => feature.id)).toEqual([
      "commute-20-minutes",
      "commute-40-minutes",
    ]);
    expect(
      surface.features.map((feature) => feature.properties.weight),
    ).toEqual([1, 0]);
    expect(surface.features[1].geometry.type).toBe("Polygon");
    expect(
      surface.features[1].geometry.type === "Polygon"
        ? surface.features[1].geometry.coordinates
        : [],
    ).toHaveLength(2);
  });
});
