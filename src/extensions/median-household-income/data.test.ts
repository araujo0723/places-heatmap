import { vi } from "vitest";
import type { MapViewport } from "../api";
import {
  clearMedianHouseholdIncomeCache,
  loadMedianHouseholdIncome,
} from "./data";

const viewport: MapViewport = {
  center: [-84.39, 33.75],
  bounds: {
    west: -84.55,
    south: 33.6,
    east: -84.23,
    north: 33.9,
  },
};

const feature = {
  type: "Feature" as const,
  id: "131210001001",
  geometry: {
    type: "Polygon" as const,
    coordinates: [
      [
        [-84.4, 33.7],
        [-84.3, 33.7],
        [-84.3, 33.8],
        [-84.4, 33.8],
        [-84.4, 33.7],
      ],
    ],
  },
  properties: {
    geoid: "131210001001",
    name: "Block Group 1",
    income: 75_000,
    marginOfError: 5_000,
    weight: 0.25,
  },
};

describe("median household income client loading", () => {
  beforeEach(() => clearMedianHouseholdIncomeCache());
  afterEach(() => vi.unstubAllGlobals());

  it("shares requests for the same Area of Interest", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) =>
      Response.json({
        regions: { type: "FeatureCollection", features: [feature] },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const signal = new AbortController().signal;
    const first = await loadMedianHouseholdIncome(viewport, signal);
    const second = await loadMedianHouseholdIncome(viewport, signal);

    expect(first.features).toEqual([feature]);
    expect(second).toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = new URL(String(fetchMock.mock.calls[0][0]), "http://localhost");
    expect(url.pathname).toBe("/api/median-household-income");
    expect(url.searchParams.get("west")).toBe("-84.55");
  });

  it("rejects malformed data without caching the failure", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) =>
      Response.json({
        regions: {
          type: "FeatureCollection",
          features: [{ ...feature, properties: { income: "unknown" } }],
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const signal = new AbortController().signal;
    await expect(
      loadMedianHouseholdIncome(viewport, signal),
    ).rejects.toThrow("malformed");
    await expect(
      loadMedianHouseholdIncome(viewport, signal),
    ).rejects.toThrow("malformed");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
