import { vi } from "vitest";
import type { GeoBounds } from "../core/geo";
import { getWaterForBounds } from "./water";

const bounds: GeoBounds = {
  west: -84.5,
  south: 33.5,
  east: -84,
  north: 34,
};

describe("water data service", () => {
  it("queries the local PBF index for the complete bounds", async () => {
    const waters = [
      { id: "way/2", name: "Test Lake", center: [-84.2, 33.8] as [number, number] },
    ];
    const query = vi.fn(async () => waters);

    await expect(
      getWaterForBounds(bounds, { query, pbfPath: "/data/georgia.osm.pbf" }),
    ).resolves.toEqual(waters);
    expect(query).toHaveBeenCalledWith(bounds, "/data/georgia.osm.pbf");
  });
});
