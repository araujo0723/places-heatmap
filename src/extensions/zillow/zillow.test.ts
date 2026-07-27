import { buildZillowRentalUrl } from "./zillow";

describe("Zillow rental URL", () => {
  it("keeps the user position separate from the custom region bounds", () => {
    const bounds = {
      west: -84.5,
      east: -84.1,
      south: 33.7,
      north: 34.1,
    };
    const url = new URL(
      buildZillowRentalUrl(bounds, "saved-region", [-84.388, 33.749]),
    );

    expect(url.searchParams.get("userPosition")).toBe("-84.388,33.749");
    const positionBounds = url.searchParams
      .get("userPositionBounds")
      ?.split(",")
      .map(Number);
    expect(positionBounds).toHaveLength(4);
    expect(positionBounds?.[0]).toBeCloseTo(33.754);
    expect(positionBounds?.[1]).toBeCloseTo(-84.383);
    expect(positionBounds?.[2]).toBeCloseTo(33.744);
    expect(positionBounds?.[3]).toBeCloseTo(-84.393);
    expect(
      JSON.parse(url.searchParams.get("searchQueryState") ?? "{}"),
    ).toMatchObject({
      mapBounds: bounds,
      customRegionId: "saved-region",
    });
  });
});
