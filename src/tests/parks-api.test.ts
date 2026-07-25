import { GET } from "../pages/api/parks";

function request(query = "") {
  return GET({
    request: new Request(`http://localhost/api/parks${query}`),
  } as never);
}

describe("parks endpoint validation", () => {
  it("requires valid zoom-11 tiles", async () => {
    expect((await request()).status).toBe(400);
    expect((await request("?tiles=10/1/1")).status).toBe(400);
  });

  it("rejects viewports covering more than 25 tiles", async () => {
    const tiles = Array.from(
      { length: 26 },
      (_, index) => `11/${index}/1000`,
    ).join(",");
    const response = await request(`?tiles=${tiles}`);
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      code: "VIEWPORT_TOO_WIDE",
    });
  });
});
