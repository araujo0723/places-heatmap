import { vi } from "vitest";
import type { GeoBounds } from "../../../core/geo";
import { getParksForBounds } from "./parks";

const bounds: GeoBounds = {
  west: -84.5,
  south: 33.5,
  east: -84,
  north: 34,
};

describe("park data service", () => {
  it("queries the local PBF index for the complete bounds", async () => {
    const parks = [
      { id: "way/1", name: "Test Park", center: [-84.25, 33.75] as [number, number] },
    ];
    const query = vi.fn(async () => parks);

    await expect(
      getParksForBounds(bounds, { query, pbfPath: "/data/georgia.osm.pbf" }),
    ).resolves.toEqual(parks);
    expect(query).toHaveBeenCalledWith(bounds, "/data/georgia.osm.pbf");
  });

  it("surfaces local index failures", async () => {
    await expect(
      getParksForBounds(bounds, {
        query: vi.fn(async () => {
          throw new Error("PBF missing");
        }),
      }),
    ).rejects.toThrow("PBF missing");
  });
});
