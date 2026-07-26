import { vi } from "vitest";
import {
  clearCommuteMemoryCache,
  getDrivingIsochrones,
  ISOCHRONE_CACHE_TTL_MILLISECONDS,
  normalizeIsochrones,
} from "./commute";

describe("commute data service", () => {
  beforeEach(() => clearCommuteMemoryCache());

  it("retains isochrones for one year", () => {
    expect(ISOCHRONE_CACHE_TTL_MILLISECONDS).toBe(31_536_000_000);
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

  it("rejects missing or malformed contour data", () => {
    expect(() => normalizeIsochrones({ features: [] }, [20])).toThrow(
      "missing polygon data",
    );
  });
});
