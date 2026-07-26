import {
  expandBoundsByMeters,
  parkQueryCoverage,
  parseTileKey,
  tileBounds,
  tileKey,
  tilesForBounds,
} from "./geo";

describe("park query geography", () => {
  it("expands a viewport by approximately five kilometres", () => {
    const expanded = expandBoundsByMeters(
      { west: 0, south: 51.5, east: 0.1, north: 51.6 },
      5_000,
    );

    expect(expanded.south).toBeCloseTo(51.455, 2);
    expect(expanded.north).toBeCloseTo(51.645, 2);
    expect(expanded.west).toBeLessThan(-0.06);
    expect(expanded.east).toBeGreaterThan(0.16);
  });

  it("uses stable zoom-11 tiles and handles antimeridian bounds", () => {
    const tiles = tilesForBounds({
      west: 179.9,
      south: -0.1,
      east: -179.9,
      north: 0.1,
    });

    expect(tiles.length).toBeGreaterThan(0);
    expect(tiles.every((tile) => tile.z === 11)).toBe(true);
    expect(new Set(tiles.map(tileKey)).size).toBe(tiles.length);
    expect(parseTileKey(tileKey(tiles[0]))).toEqual(tiles[0]);
    expect(parseTileKey("10/1/1")).toBeUndefined();
    expect(tileBounds(tiles[0]).west).toBeGreaterThanOrEqual(-180);
  });

  it("exposes complete coverage without imposing a request cap", () => {
    const coverage = parkQueryCoverage({
      center: [0, 0],
      bounds: { west: -20, south: -20, east: 20, north: 20 },
    });
    expect(coverage.tiles.length).toBeGreaterThan(25);
  });
});
