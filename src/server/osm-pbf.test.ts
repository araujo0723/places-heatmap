import type { LocalOsmIndex } from "./osm-pbf";
import { queryLocalOsmIndex } from "./osm-pbf";

const index: LocalOsmIndex = {
  version: 1,
  source: {
    path: "/data/georgia-latest.osm.pbf",
    size: 123,
    mtimeMs: 456,
  },
  parks: [
    {
      id: "node/1",
      center: [-84.3, 33.8],
    },
    {
      id: "way/2",
      center: [-82, 32],
      bbox: { west: -82.2, south: 31.8, east: -81.8, north: 32.2 },
    },
  ],
  waters: [
    {
      id: "relation/3",
      name: "Test Lake",
      center: [-84.1, 33.9],
      bbox: { west: -84.2, south: 33.8, east: -84, north: 34 },
    },
  ],
};

describe("local OSM index queries", () => {
  it("returns every matching record without a result limit", () => {
    const manyParks = Array.from({ length: 100 }, (_, index) => ({
      id: `node/${index + 10}`,
      center: [-84.3, 33.8] as [number, number],
    }));
    const result = queryLocalOsmIndex(
      { ...index, parks: [...index.parks, ...manyParks] },
      "parks",
      { west: -85, south: 33, east: -83, north: 35 },
    );

    expect(result).toHaveLength(101);
  });

  it("uses feature bounds, not only centers, for intersections", () => {
    expect(
      queryLocalOsmIndex(index, "waters", {
        west: -84.25,
        south: 33.85,
        east: -84.15,
        north: 33.95,
      }),
    ).toEqual(index.waters);
  });
});
