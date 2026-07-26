import { expect, test, type Page } from "@playwright/test";

const mapTilePng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAQAAAAEAAQMAAABmvDolAAAABGdBTUEAALGPC/xhBQAAACBjSFJNAAB6JgAAgIQAAPoAAACA6AAAdTAAAOpgAAA6mAAAF3CculE8AAAABlBMVEXi6PD///9gl7/tAAAAAWJLR0QB/wIt3gAAAAd0SU1FB+oHGREgKS7oI8gAAAAfSURBVGje7cEBDQAAAMKg909tDjegAAAAAAAAAAC+DSEAAAF/GZynAAAAJXRFWHRkYXRlOmNyZWF0ZQAyMDI2LTA3LTI1VDE3OjMyOjQxKzAwOjAwxWCutAAAACV0RVh0ZGF0ZTptb2RpZnkAMjAyNi0wNy0yNVQxNzozMjo0MSswMDowMLQ9FggAAAAASUVORK5CYII=",
  "base64",
);

test.beforeEach(async ({ page }) => {
  await page.route("https://tile.openstreetmap.org/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "image/png",
      body: mapTilePng,
    }),
  );
});

async function drawArea(page: Page) {
  await expect(page.getByTestId("location-status")).toHaveText(
    "Centered near you",
  );
  await expect(page.getByTestId("area-of-interest-count")).toHaveText("1");
}

const contributionLabels: Record<string, string> = {
  "nearby-parks/distance": "Parks",
  "nearby-water/distance": "Lakes",
  "nearby-parks/influence": "Parks",
  "nearby-water/influence": "Lakes",
};

async function addContribution(
  page: Page,
  type: "Filter" | "Heatmap",
  key: string,
) {
  await page.getByRole("button", { name: `Add ${type}` }).click();
  await page
    .getByRole("menuitem", { name: contributionLabels[key] })
    .click();
}

test("starts with the bundled data contributions", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByTestId("location-status")).toHaveText(
    "Centered near you",
  );
  await expect(page.locator("astro-dev-toolbar")).toHaveCount(0);
  await expect(page.getByText("© OpenStreetMap contributors")).toBeVisible();
  await expect(page.getByText("No active filters")).toBeVisible();
  await expect(page.getByText("No active heatmaps")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Actions" })).toBeVisible();
  const zillowButton = page.getByRole("button", { name: "GO TO ZILLOW" });
  await expect(zillowButton).toBeEnabled();
  await expect(zillowButton.locator('img[src="/icons/house.svg"]')).toBeVisible();
  await expect(page.getByText("Places workspace")).toHaveCount(0);
  await expect(page.getByText("Explore the map")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Set origin" }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Add Filter" }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Add Heatmap" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Add Filter" }).click();
  await expect(
    page.getByRole("menuitem", { name: "Parks" }).locator("img"),
  ).toHaveAttribute("src", "/icons/tree.svg");
  await expect(
    page.getByRole("menuitem", { name: "Lakes" }).locator("img"),
  ).toHaveAttribute("src", "/icons/water.svg");
  await expect(
    page.getByRole("menuitem", { name: "Commute" }).locator("img"),
  ).toHaveAttribute("src", "/icons/car.svg");
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("heading", { name: "Area of interest" }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: "RESET ALL" })).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Clear all filters" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Clear all heatmaps" }),
  ).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(() =>
        JSON.parse(
          localStorage.getItem("places-heatmap:last-location") ?? "null",
        ),
      ),
    )
    .toEqual({ longitude: -74.006, latitude: 40.7128 });
});

test("shows one unfaded, unclipped hint for header buttons", async ({
  page,
}) => {
  await page.route("**/api/parks?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ tiles: [], parks: [] }),
    }),
  );
  await page.goto("/");
  await drawArea(page);
  await addContribution(page, "Filter", "nearby-parks/distance");
  await expect(
    page
      .getByRole("button", { name: "Remove Parks filter" })
      .locator("xpath=ancestor::article")
      .locator('img[src="/icons/tree.svg"]'),
  ).toBeVisible();

  for (const label of [
    "Set origin",
    "Add Filter",
    "Add Heatmap",
    "RESET ALL",
  ]) {
    expect(
      await page.getByRole("button", { name: label }).getAttribute("title"),
    ).toBeNull();
  }

  const resetButton = page.getByRole("button", { name: "RESET ALL" });
  const resetHint = page.getByRole("tooltip", {
    name: "Reset all filters and heatmaps",
  });
  await resetButton.hover();

  await expect
    .poll(() =>
      resetHint.evaluate((element) => getComputedStyle(element).opacity),
    )
    .toBe("1");
  expect(
    await resetButton.evaluate((element) => getComputedStyle(element).opacity),
  ).toBe("0.8");

  const sidebarBounds = await page.locator("aside").boundingBox();
  const hintBounds = await resetHint.boundingBox();
  expect(sidebarBounds).not.toBeNull();
  expect(hintBounds).not.toBeNull();
  if (sidebarBounds && hintBounds) {
    expect(hintBounds.x).toBeGreaterThanOrEqual(sidebarBounds.x);
    expect(hintBounds.x + hintBounds.width).toBeLessThanOrEqual(
      sidebarBounds.x + sidebarBounds.width,
    );
  }
});

test("loads nearby park regions and influence contours", async ({ page }) => {
  let parkRequests = 0;
  await page.route("**/api/parks?**", async (route) => {
    parkRequests += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        tiles: [],
        parks: [
          {
            id: "way/1",
            name: "Box Park",
            center: [-74.006, 40.7128],
            bbox: {
              west: -74.012,
              south: 40.708,
              east: -74,
              north: 40.718,
            },
          },
          {
            id: "node/2",
            name: "Point Park",
            center: [-73.99, 40.72],
          },
        ],
      }),
    });
  });
  await page.goto("/");
  await drawArea(page);

  await addContribution(page, "Filter", "nearby-parks/distance");
  await expect(
    page.getByRole("slider", { name: "Park distance" }),
  ).toBeEnabled();
  await expect(page.getByText("Active", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Off", { exact: true })).toHaveCount(0);

  await page.getByRole("slider", { name: "Park distance" }).fill("0");

  await addContribution(page, "Heatmap", "nearby-parks/influence");
  await expect(
    page
      .getByRole("button", { name: "Remove Parks heatmap" })
      .locator("xpath=ancestor::article")
      .locator('img[src="/icons/tree.svg"]'),
  ).toBeVisible();
  await expect(page.getByTestId("map-active-summary")).toContainText(
    "Parks2",
  );
  const settledParkRequests = parkRequests;
  expect(settledParkRequests).toBeGreaterThan(0);

  const map = page.getByTestId("map");
  const box = await map.boundingBox();
  expect(box).not.toBeNull();
  if (box) {
    for (let index = 0; index < 3; index += 1) {
      await page.mouse.move(box.x + box.width * 0.9, box.y + box.height * 0.5);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.5, {
        steps: 10,
      });
      await page.mouse.up();
      await page.waitForTimeout(600);
    }
  }
  expect(parkRequests).toBe(settledParkRequests);

  await page.getByRole("button", { name: "Remove Parks filter" }).click();
  await expect(page.getByTestId("area-of-interest-count")).toHaveText("1");
  await page.getByRole("button", { name: "Remove Parks heatmap" }).click();
});

test("loads nearby water regions and blue influence contours", async ({ page }) => {
  let waterRequests = 0;
  await page.route("**/api/water?**", async (route) => {
    waterRequests += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        tiles: [],
        waters: [
          {
            id: "way/11",
            name: "Blue Lake",
            center: [-74.006, 40.7128],
            bbox: {
              west: -74.012,
              south: 40.708,
              east: -74,
              north: 40.718,
            },
          },
          {
            id: "node/12",
            name: "Small Pond",
            center: [-73.99, 40.72],
          },
        ],
      }),
    });
  });
  await page.goto("/");
  await drawArea(page);

  await addContribution(page, "Filter", "nearby-water/distance");
  await expect(
    page.getByRole("slider", { name: "Water distance" }),
  ).toBeVisible();

  await addContribution(page, "Heatmap", "nearby-water/influence");
  await expect(page.getByTestId("map-active-summary")).toContainText(
    "Lakes2",
  );
  expect(waterRequests).toBeGreaterThan(0);
});

test("allows duplicate heatmap instances", async ({ page }) => {
  await page.route("**/api/parks?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ tiles: [], parks: [] }),
    }),
  );
  await page.goto("/");
  await drawArea(page);

  await addContribution(page, "Heatmap", "nearby-parks/influence");
  await addContribution(page, "Heatmap", "nearby-parks/influence");

  const removeButtons = page.getByRole("button", {
    name: "Remove Parks heatmap",
  });
  await expect(removeButtons).toHaveCount(2);
  await expect(
    page.getByTestId("map-active-summary").getByText("Parks"),
  ).toHaveCount(2);

  await removeButtons.first().click();
  await expect(removeButtons).toHaveCount(1);
});

test("changes the automatic Area of Interest with Set origin", async ({ page }) => {
  let suggestionRequest = "";
  await page.route("**/api/address-suggestions?**", async (route) => {
    suggestionRequest = route.request().url();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        suggestions: [
          {
            label: "1 Peachtree St, Atlanta, GA",
            address: "1 Peachtree St, Atlanta, GA",
            center: [-84.388, 33.749],
          },
        ],
      }),
    });
  });
  await page.goto("/");
  await drawArea(page);

  await page.getByRole("button", { name: "Set origin" }).click();
  await expect(page.getByRole("dialog", { name: "Set origin" })).toBeVisible();
  await page
    .getByRole("textbox", { name: "Origin address" })
    .fill("Peachtree");
  await page
    .getByRole("button", { name: "1 Peachtree St, Atlanta, GA" })
    .click();

  await expect(page.getByRole("dialog", { name: "Set origin" })).toHaveCount(0);
  await expect(page.getByTestId("area-of-interest-count")).toHaveText("1");
  await expect
    .poll(() =>
      page.evaluate(() =>
        JSON.parse(
          localStorage.getItem("places-heatmap:last-location") ?? "null",
        ),
      ),
    )
    .toEqual({ longitude: -84.388, latitude: 33.749 });
  expect(new URL(suggestionRequest).searchParams.get("longitude")).toBe(
    "-74.006",
  );
  expect(new URL(suggestionRequest).searchParams.get("latitude")).toBe(
    "40.7128",
  );
});
