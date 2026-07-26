import { vi } from "vitest";
import {
  clearCommuteMemoryCache,
  getDrivingIsochrones,
  lookupAddressSuggestions,
  normalizeIsochrones,
  normalizeNominatimSuggestions,
  normalizeOrsSuggestions,
} from "./commute";

describe("commute data service", () => {
  beforeEach(() => clearCommuteMemoryCache());

  it("normalizes valid address suggestions from both geocoders", () => {
    expect(
      normalizeNominatimSuggestions([
        {
          display_name: "1 Peachtree St, Atlanta, Georgia",
          lon: "-84.388",
          lat: "33.749",
        },
        { display_name: "Broken", lon: "nope", lat: "33.7" },
      ]),
    ).toEqual([
      {
        label: "1 Peachtree St, Atlanta, Georgia",
        address: "1 Peachtree St, Atlanta, Georgia",
        center: [-84.388, 33.749],
      },
    ]);
    expect(
      normalizeOrsSuggestions({
        features: [
          {
            geometry: { coordinates: [-84.388, 33.749] },
            properties: { label: "1 Peachtree St, Atlanta, GA" },
          },
        ],
      }),
    ).toEqual([
      {
        label: "1 Peachtree St, Atlanta, GA",
        address: "1 Peachtree St, Atlanta, GA",
        center: [-84.388, 33.749],
      },
    ]);
  });

  it("uses Nominatim when ORS address lookup is unavailable", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("busy", { status: 503 }))
      .mockResolvedValueOnce(
        Response.json([
          {
            display_name: "10 Downing St, London",
            lon: "-0.1276",
            lat: "51.5034",
          },
        ]),
      );

    await expect(
      lookupAddressSuggestions("10 Downing", {
        fetch: fetchMock as typeof fetch,
        orsApiKey: "test-key",
        orsBaseUrl: "https://ors.test",
        nominatimBaseUrl: "https://nominatim.test",
      }),
    ).resolves.toHaveLength(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/geocode/search");
    expect(String(fetchMock.mock.calls[1][0])).toContain("/search");
  });

  it("biases address lookup and ranks nearby suggestions first", async () => {
    const fetchMock = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) =>
        Response.json([
          {
            display_name: "Main Street, London",
            lon: "-0.1276",
            lat: "51.5034",
          },
          {
            display_name: "Main Street, Atlanta, Georgia",
            lon: "-84.39",
            lat: "33.75",
          },
        ]),
    );

    await expect(
      lookupAddressSuggestions("Main Street", {
        fetch: fetchMock as typeof fetch,
        nominatimBaseUrl: "https://nominatim.test",
        orsApiKey: "",
        proximity: [-84.388, 33.749],
      }),
    ).resolves.toEqual([
      {
        label: "Main Street, Atlanta, Georgia",
        address: "Main Street, Atlanta, Georgia",
        center: [-84.39, 33.75],
      },
      {
        label: "Main Street, London",
        address: "Main Street, London",
        center: [-0.1276, 51.5034],
      },
    ]);

    const requestUrl = new URL(String(fetchMock.mock.calls[0][0]));
    expect(requestUrl.searchParams.get("viewbox")).toBe(
      "-85.388,34.749,-83.388,32.749",
    );
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
