import { vi } from "vitest";

vi.mock("./server/income", () => ({
  getIncomeForBounds: vi.fn(async () => ({
    type: "FeatureCollection",
    features: [],
  })),
}));

import { GET } from "./pages/api/median-household-income";

function request(query = "") {
  return GET({
    request: new Request(
      `http://localhost/api/median-household-income${query}`,
    ),
  } as never);
}

describe("median household income endpoint", () => {
  it("requires valid query bounds", async () => {
    expect((await request()).status).toBe(400);
    expect(
      (
        await request(
          "?west=-181&south=33.6&east=-84.2&north=33.9",
        )
      ).status,
    ).toBe(400);
  });

  it("returns a complete Area of Interest response", async () => {
    const response = await request(
      "?west=-84.55&south=33.6&east=-84.23&north=33.9",
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      regions: { type: "FeatureCollection", features: [] },
    });
  });
});
