import { vi } from "vitest";
import { POST } from "../pages/api/zillow/custom-region";

function request(polygons: unknown) {
  return POST({
    request: new Request("http://localhost/api/zillow/custom-region", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ polygons }),
    }),
  } as never);
}

describe("Zillow custom-region endpoint", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("validates the boundary before contacting Zillow", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    expect((await request([])).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("saves a simplified custom region", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        data: {
          saveCustomRegion: {
            customRegionId: "zillow-region-1",
            polygon: "saved",
          },
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await request([
      [
        [-84.3, 33.95],
        [-84.2, 33.95],
        [-84.2, 34.05],
        [-84.3, 34.05],
        [-84.3, 33.95],
      ],
    ]);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      customRegionId: "zillow-region-1",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://www.zillow.com/zg-graph?operationName=SaveCustomRegion",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
