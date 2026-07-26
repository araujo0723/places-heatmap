import { vi } from "vitest";
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

  it("loads a large area in one unbounded local-index request", async () => {
    const largeViewport: MapViewport = {
      center: [-84.295, 34.075],
      bounds: {
        west: -84.73,
        south: 33.71,
        east: -83.86,
        north: 34.44,
      },
    };
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

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const parameters = new URL(
      String(fetchMock.mock.calls[0][0]),
      "http://localhost",
    ).searchParams;
    expect(parameters.has("tiles")).toBe(false);
    expect(parameters.get("west")).toBeTruthy();
    expect(parameters.get("north")).toBeTruthy();
  });
});
