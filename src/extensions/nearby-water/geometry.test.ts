import type { WaterRecord } from "../../core/water";
import { waterFilterRegions, waterHeatContours } from "./geometry";

const waters: WaterRecord[] = [
  {
    id: "way/1",
    name: "Box Lake",
    center: [0, 0],
    bbox: { west: -0.001, south: -0.001, east: 0.001, north: 0.001 },
  },
  {
    id: "node/2",
    name: "Point Pond",
    center: [0.01, 0.01],
  },
];

describe("nearby water geometry", () => {
  it("creates water-owned distance regions", () => {
    const result = waterFilterRegions(waters, 300);

    expect(result.itemCount).toBe(2);
    expect(result.regions[0].properties).toMatchObject({
      waterId: "way/1",
      name: "Box Lake",
    });
    expect(result.regions[0].properties).not.toHaveProperty("parkId");
  });

  it("creates full-strength water cores and fading contour bands", () => {
    const contours = waterHeatContours(waters);

    expect(contours.features[0]).toMatchObject({
      id: "water-heat-core",
      properties: { weight: 1 },
    });
    expect(contours.features.at(-1)?.id).toBe("water-heat-band-12");
    expect(contours.features.at(-1)?.properties.weight).toBeLessThan(0.1);
  });
});
