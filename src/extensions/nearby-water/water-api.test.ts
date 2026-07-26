import { vi } from "vitest";

vi.mock("./server/water", () => ({
  getWaterForBounds: vi.fn(async () => []),
}));

import { GET } from "./pages/api/water";

function request(query = "") {
  return GET({
    request: new Request(`http://localhost/api/water${query}`),
  } as never);
}

describe("water endpoint validation", () => {
  it("requires valid query bounds", async () => {
    expect((await request()).status).toBe(400);
    expect(
      (await request("?west=-85&south=36&east=-80&north=30")).status,
    ).toBe(400);
  });

  it("accepts a complete region without a tile-count limit", async () => {
    const response = await request(
      "?west=-85.7&south=30.3&east=-80.8&north=35.1",
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ waters: [] });
  });
});
