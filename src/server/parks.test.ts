import { vi } from "vitest";
import type { MapTile } from "../core/geo";
import {
  clearParkMemoryCache,
  getParksForTiles,
  normalizeOrsFeatures,
  normalizeOverpassElements,
  PARK_CACHE_TTL_SECONDS,
} from "./parks";

const tile: MapTile = { z: 11, x: 1024, y: 1024 };

describe("park data service", () => {
  beforeEach(() => clearParkMemoryCache());

  it("normalizes nodes and bounded ways and rejects malformed elements", () => {
    expect(
      normalizeOverpassElements([
        {
          type: "node",
          id: 1,
          lat: -0.01,
          lon: 0.01,
          tags: { name: "Node Park" },
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
        { type: "way", id: "bad" },
      ]),
    ).toEqual([
      {
        id: "node/1",
        name: "Node Park",
        center: [0.01, -0.01],
      },
      {
        id: "way/2",
        center: [0.02, -0.02],
        bbox: { west: 0.01, south: -0.03, east: 0.03, north: -0.01 },
      },
    ]);
  });

  it("normalizes center-only ORS park features", () => {
    expect(
      normalizeOrsFeatures([
        {
          geometry: { type: "Point", coordinates: [0.01, -0.01] },
          properties: {
            osm_id: 7,
            osm_type: 2,
            osm_tags: { name: "Fallback Park" },
          },
        },
      ]),
    ).toEqual([
      {
        id: "way/7",
        name: "Fallback Park",
        center: [0.01, -0.01],
      },
    ]);
  });

  it("batches missing tiles, writes six-hour cache entries, and reuses memory", async () => {
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

    const first = await getParksForTiles([tile], {
      fetch: fetchMock as typeof fetch,
      redis: redis as never,
      now: () => 1_000,
    });
    const second = await getParksForTiles([tile], {
      fetch: fetchMock as typeof fetch,
      redis: redis as never,
      now: () => 2_000,
    });

    expect(first).toHaveLength(1);
    expect(second).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(writes[0][2]).toEqual({ EX: PARK_CACHE_TTL_SECONDS });
  });

  it("uses Redis hits and falls back when Redis is unavailable", async () => {
    const cachedPark = { id: "node/5", center: [0.01, -0.01] };
    const fetchMock = vi.fn(async () => Response.json({ elements: [] }));
    const redisHit = {
      mGet: vi.fn(async () => [JSON.stringify([cachedPark])]),
      multi: vi.fn(),
    };
    expect(
      await getParksForTiles([tile], {
        fetch: fetchMock as typeof fetch,
        redis: redisHit as never,
      }),
    ).toEqual([cachedPark]);
    expect(fetchMock).not.toHaveBeenCalled();

    clearParkMemoryCache();
    const brokenRedis = {
      mGet: vi.fn(async () => {
        throw new Error("offline");
      }),
      multi: vi.fn(() => {
        throw new Error("offline");
      }),
    };
    await expect(
      getParksForTiles([tile], {
        fetch: fetchMock as typeof fetch,
        redis: brokenRedis as never,
      }),
    ).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to ORS when Overpass is overloaded", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) =>
      String(url).includes("overpass.test")
        ? new Response("busy", { status: 504 })
        : Response.json({
          features: [
            {
              geometry: { type: "Point", coordinates: [0.01, -0.01] },
              properties: { osm_id: 9, osm_type: 1 },
            },
          ],
        }),
    );

    await expect(
      getParksForTiles([tile], {
        fetch: fetchMock as typeof fetch,
        overpassUrl: "https://overpass.test/interpreter",
        orsApiKey: "test-key",
      }),
    ).resolves.toEqual([{ id: "node/9", center: [0.01, -0.01] }]);
    expect(fetchMock).toHaveBeenCalledTimes(10);
    expect(fetchMock.mock.calls[1][0]).toBe(
      "https://api.openrouteservice.org/pois",
    );
  });

  it("surfaces upstream failures", async () => {
    await expect(
      getParksForTiles([tile], {
        fetch: vi.fn(async () => new Response("busy", { status: 429 })) as never,
        redis: undefined,
      }),
    ).rejects.toThrow("status 429");
  });
});
