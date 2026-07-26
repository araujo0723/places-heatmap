import { vi } from "vitest";
import type { MapTile } from "../core/geo";
import {
  clearWaterMemoryCache,
  getWaterForTiles,
  normalizeWaterElements,
  WATER_CACHE_TTL_SECONDS,
  waterOverpassQuery,
} from "./water";

const tile: MapTile = { z: 11, x: 1024, y: 1024 };

describe("water data service", () => {
  beforeEach(() => clearWaterMemoryCache());

  it("queries enclosed water types without linear waterways", () => {
    const query = waterOverpassQuery([tile]);

    expect(query).toContain('["natural"="water"][!"water"]');
    expect(query).toContain("lake|pond|reservoir|basin|lagoon|oxbow|cenote");
    expect(query).toContain("stream_pool|reflecting_pool|moat|fishpond");
    expect(query).toContain('["landuse"="reservoir"]');
    expect(query).toContain('["landuse"="salt_pond"]');
    expect(query).not.toContain("river|canal|stream|ditch");
  });

  it("normalizes nodes and bounded ways", () => {
    expect(
      normalizeWaterElements([
        {
          type: "node",
          id: 1,
          lat: -0.01,
          lon: 0.01,
          tags: { name: "Node Pond" },
        },
        {
          type: "way",
          id: 2,
          center: { lat: -0.02, lon: 0.02 },
          bounds: {
            minlat: -0.03,
            minlon: 0.01,
            maxlat: -0.01,
            maxlon: 0.03,
          },
        },
      ]),
    ).toEqual([
      {
        id: "node/1",
        name: "Node Pond",
        center: [0.01, -0.01],
      },
      {
        id: "way/2",
        center: [0.02, -0.02],
        bbox: { west: 0.01, south: -0.03, east: 0.03, north: -0.01 },
      },
    ]);
  });

  it("writes one-year cache entries and reuses memory", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        elements: [
          { type: "node", id: 1, lat: -0.01, lon: 0.01 },
          { type: "node", id: 1, lat: -0.01, lon: 0.01 },
        ],
      }),
    );
    const writes: Array<unknown[]> = [];
    const redis = {
      mGet: vi.fn(async () => [null]),
      multi: () => ({
        set: (...args: unknown[]) => {
          writes.push(args);
          return this;
        },
        exec: vi.fn(async () => []),
      }),
    };

    const first = await getWaterForTiles([tile], {
      fetch: fetchMock as typeof fetch,
      redis: redis as never,
      now: () => 1_000,
      overpassUrl: "https://overpass.test/interpreter",
    });
    const second = await getWaterForTiles([tile], {
      fetch: fetchMock as typeof fetch,
      redis: redis as never,
      now: () => 2_000,
      overpassUrl: "https://overpass.test/interpreter",
    });

    expect(first).toHaveLength(1);
    expect(second).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(WATER_CACHE_TTL_SECONDS).toBe(31_536_000);
    expect(writes[0][2]).toEqual({ EX: WATER_CACHE_TTL_SECONDS });
  });

  it("surfaces upstream failures", async () => {
    await expect(
      getWaterForTiles([tile], {
        fetch: vi.fn(async () => new Response("busy", { status: 429 })) as never,
        overpassUrl: "https://overpass.test/interpreter",
      }),
    ).rejects.toThrow("status 429");
  });
});
