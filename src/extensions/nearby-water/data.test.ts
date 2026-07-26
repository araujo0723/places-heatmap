import { afterEach, beforeEach, vi } from "vitest";
import type { MapViewport } from "../api";
import { clearNearbyWaterCache, loadNearbyWater } from "./data";

const viewport: MapViewport = {
  center: [0, 0],
  bounds: { west: -0.01, south: -0.01, east: 0.01, north: 0.01 },
};

describe("nearby water client loading", () => {
  beforeEach(() => clearNearbyWaterCache());
  afterEach(() => vi.unstubAllGlobals());

  it("shares tile responses between contributions", async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request) =>
      Response.json({
        waters: [
          {
            id: "way/1",
            name: "Test Pond",
            center: [0, 0],
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const first = await loadNearbyWater(
      viewport,
      new AbortController().signal,
    );
    const second = await loadNearbyWater(
      viewport,
      new AbortController().signal,
    );

    expect(first).toEqual(second);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/api/water?west=");
    expect(String(fetchMock.mock.calls[0][0])).not.toContain("tiles=");
  });

  it("rejects malformed responses without retaining them", async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request) =>
      Response.json({ waters: [{}] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      loadNearbyWater(viewport, new AbortController().signal),
    ).rejects.toThrow("malformed");
    await expect(
      loadNearbyWater(viewport, new AbortController().signal),
    ).rejects.toThrow("malformed");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
