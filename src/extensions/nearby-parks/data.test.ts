import { vi } from "vitest";
import {
  MAX_PARK_TILES,
  parkQueryCoverage,
} from "../../core/geo";
import type { MapViewport } from "../api";
import { clearNearbyParkCache, loadNearbyParks } from "./data";

const viewport: MapViewport = {
  center: [0, 51.5],
  bounds: { west: -0.02, south: 51.48, east: 0.02, north: 51.52 },
};

describe("nearby park client loading", () => {
  beforeEach(() => clearNearbyParkCache());
  afterEach(() => vi.unstubAllGlobals());

  it("shares tile requests and filters records to the expanded viewport", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        parks: [
          { id: "node/1", center: [0, 51.5] },
          { id: "node/2", center: [20, 20] },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const first = await loadNearbyParks(viewport, new AbortController().signal);
    const second = await loadNearbyParks(viewport, new AbortController().signal);
    expect(first.map(({ id }) => id)).toEqual(["node/1"]);
    expect(second).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed payloads and does not cache the failure", async () => {
    const fetchMock = vi.fn(async () => Response.json({ parks: [{}] }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      loadNearbyParks(viewport, new AbortController().signal),
    ).rejects.toThrow("malformed");
    await expect(
      loadNearbyParks(viewport, new AbortController().signal),
    ).rejects.toThrow("malformed");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("splits large areas into valid API batches and merges duplicate parks", async () => {
    const largeViewport: MapViewport = {
      center: [-84.295, 34.075],
      bounds: {
        west: -84.73,
        south: 33.71,
        east: -83.86,
        north: 34.44,
      },
    };
    const tileCount = parkQueryCoverage(largeViewport).tiles.length;
    expect(tileCount).toBeGreaterThan(MAX_PARK_TILES);

    const fetchMock = vi.fn(async (_input: RequestInfo | URL) =>
      Response.json({
        parks: [
          { id: "node/shared", center: [-84.295, 34.075] },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      loadNearbyParks(largeViewport, new AbortController().signal),
    ).resolves.toEqual([
      { id: "node/shared", center: [-84.295, 34.075] },
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(
      Math.ceil(tileCount / MAX_PARK_TILES),
    );
    for (const [input] of fetchMock.mock.calls) {
      const parameters = new URL(String(input), "http://localhost")
        .searchParams;
      expect(
        parameters.get("tiles")?.split(",").length,
      ).toBeLessThanOrEqual(MAX_PARK_TILES);
    }
  });
});
