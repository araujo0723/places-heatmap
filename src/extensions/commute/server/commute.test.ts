import { vi } from "vitest";
import {
  clearCommuteMemoryCache,
  commuteIsochroneCacheKey,
  getDrivingIsochrones,
  ISOCHRONE_CACHE_TTL_MILLISECONDS,
  ISOCHRONE_CACHE_TTL_SECONDS,
  normalizeIsochrones,
  type RedisIsochroneCache,
} from "./commute";

function orsContour(minutes: number) {
  return {
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [0, 0],
          [minutes, 0],
          [minutes, minutes],
          [0, 0],
        ],
      ],
    },
    properties: { value: minutes * 60 },
  };
}

function createRedisCache() {
  const values = new Map<string, string>();
  const redis = {
    get: vi.fn(async (key: string) => values.get(key) ?? null),
    set: vi.fn(
      async (
        key: string,
        value: string,
        _options: { EX: number },
      ) => {
        values.set(key, value);
        return "OK";
      },
    ),
  } satisfies RedisIsochroneCache;
  return { redis, values };
}

describe("commute data service", () => {
  beforeEach(() => clearCommuteMemoryCache());

  it("retains isochrones for one year", () => {
    expect(ISOCHRONE_CACHE_TTL_MILLISECONDS).toBe(31_536_000_000);
    expect(ISOCHRONE_CACHE_TTL_SECONDS).toBe(31_536_000);
  });

  it("hashes the destination and individual commute time into the cache key", () => {
    const first = commuteIsochroneCacheKey([-84.388, 33.749], 20);

    expect(first).toMatch(
      /^places-heatmap:commute:isochrone:v1:[a-f0-9]{64}$/,
    );
    expect(
      commuteIsochroneCacheKey([-84.388, 33.749], 20),
    ).toBe(first);
    expect(
      commuteIsochroneCacheKey([-84.388, 33.749], 40),
    ).not.toBe(first);
    expect(
      commuteIsochroneCacheKey([-84.389, 33.749], 20),
    ).not.toBe(first);
  });

  it("requests destination driving contours and normalizes their minutes", async () => {
    const fetchMock = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) =>
        Response.json({
        features: [
          {
            geometry: {
              type: "Polygon",
              coordinates: [
                [
                  [0, 0],
                  [1, 0],
                  [1, 1],
                  [0, 0],
                ],
              ],
            },
            properties: { value: 1200 },
          },
          {
            geometry: {
              type: "Polygon",
              coordinates: [
                [
                  [0, 0],
                  [2, 0],
                  [2, 2],
                  [0, 0],
                ],
              ],
            },
            properties: { value: 2400 },
          },
        ],
        }),
    );

    const collection = await getDrivingIsochrones(
      [-84.388, 33.749],
      [20, 40],
      {
        fetch: fetchMock as typeof fetch,
        orsApiKey: "test-key",
        orsBaseUrl: "https://ors.test",
        redis: null,
      },
    );
    expect(collection.features.map(({ properties }) => properties.minutes)).toEqual([
      20, 40,
    ]);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({
      locations: [[-84.388, 33.749]],
      range: [1200, 2400],
      range_type: "time",
      location_type: "destination",
    });
  });

  it("persists each contour in Redis and reuses it across heatmap time sets", async () => {
    const { redis } = createRedisCache();
    const fetchMock = vi.fn(
      async (_input: string | URL | Request, init?: RequestInit) => {
        const request = JSON.parse(String(init?.body)) as {
          range: number[];
        };
        return Response.json({
          features: request.range.map((seconds) =>
            orsContour(seconds / 60),
          ),
        });
      },
    );
    const dependencies = {
      fetch: fetchMock as typeof fetch,
      orsApiKey: "test-key",
      orsBaseUrl: "https://ors.test",
      redis,
    };

    await getDrivingIsochrones(
      [-84.388, 33.749],
      [20, 40],
      dependencies,
    );
    clearCommuteMemoryCache();
    const collection = await getDrivingIsochrones(
      [-84.388, 33.749],
      [15, 20],
      dependencies,
    );

    expect(collection.features.map(({ properties }) => properties.minutes))
      .toEqual([15, 20]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(
      JSON.parse(String(fetchMock.mock.calls[1][1]?.body)).range,
    ).toEqual([900]);
    expect(redis.set).toHaveBeenCalledTimes(3);
    expect(
      redis.set.mock.calls.map(([, , options]) => options),
    ).toEqual([
      { EX: ISOCHRONE_CACHE_TTL_SECONDS },
      { EX: ISOCHRONE_CACHE_TTL_SECONDS },
      { EX: ISOCHRONE_CACHE_TTL_SECONDS },
    ]);
  });

  it("continues without caching when Redis is unavailable", async () => {
    const redis = {
      get: vi.fn(async () => {
        throw new Error("Redis unavailable");
      }),
      set: vi.fn(async () => {
        throw new Error("Redis unavailable");
      }),
    } satisfies RedisIsochroneCache;
    const fetchMock = vi.fn(async () =>
      Response.json({ features: [orsContour(20)] }),
    );

    const collection = await getDrivingIsochrones(
      [-84.388, 33.749],
      [20],
      {
        fetch: fetchMock as typeof fetch,
        orsApiKey: "test-key",
        orsBaseUrl: "https://ors.test",
        redis,
      },
    );

    expect(collection.features).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("rejects missing or malformed contour data", () => {
    expect(() => normalizeIsochrones({ features: [] }, [20])).toThrow(
      "missing polygon data",
    );
  });
});
