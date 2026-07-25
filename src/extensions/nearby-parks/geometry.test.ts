import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import { point } from "@turf/helpers";
import type { ParkRecord } from "../../core/parks";
import { parkFilterRegions, parkHeatContours } from "./geometry";

const parks: ParkRecord[] = [
  {
    id: "way/1",
    name: "Box Park",
    center: [0, 0],
    bbox: { west: -0.001, south: -0.001, east: 0.001, north: 0.001 },
  },
  {
    id: "node/2",
    name: "Point Park",
    center: [0.01, 0.01],
  },
];

describe("nearby park geometry", () => {
  it("expands bboxes and omits zero-radius point parks", () => {
    const zero = parkFilterRegions(parks, 0);
    expect(zero.itemCount).toBe(1);
    expect(zero.regions).toHaveLength(1);

    const buffered = parkFilterRegions(parks, 300);
    expect(buffered.itemCount).toBe(2);
    expect(buffered.regions).toHaveLength(2);
    const bboxRing = buffered.regions[0].geometry;
    expect(bboxRing.type).toBe("Polygon");
    if (bboxRing.type === "Polygon") {
      expect(bboxRing.coordinates[0][0][0]).toBeLessThan(-0.003);
    }
  });

  it("creates a full-strength core and twelve non-overlapping fade bands", () => {
    const contours = parkHeatContours(parks);
    expect(contours.features).toHaveLength(13);
    expect(contours.features[0].properties.weight).toBe(1);
    expect(contours.features[0].geometry.type).toBe("MultiPolygon");
    expect(contours.features.at(-1)?.properties.weight).toBeGreaterThan(0);
    expect(contours.features.at(-1)?.properties.weight).toBeLessThan(0.1);
    expect(
      contours.features.every(({ geometry }) =>
        ["Polygon", "MultiPolygon"].includes(geometry.type),
      ),
    ).toBe(true);
  });

  it("keeps overlapping park influence at the highest contour weight", () => {
    const overlapping: ParkRecord[] = [
      parks[0],
      {
        id: "node/3",
        center: [0.002, 0],
      },
    ];
    const contours = parkHeatContours(overlapping);
    const insideFirstCore = point([0.0005, 0]);
    const matches = contours.features.filter((contour) =>
      booleanPointInPolygon(insideFirstCore, contour),
    );

    expect(matches).toHaveLength(1);
    expect(matches[0].properties.weight).toBe(1);
  });
});
