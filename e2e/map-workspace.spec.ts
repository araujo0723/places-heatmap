import { expect, test } from "@playwright/test";

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
  await expect(page.getByRole("button", { name: "GO TO ZILLOW" })).toBeDisabled();
  await expect(page.getByText("Places workspace")).toHaveCount(0);
  await expect(page.getByText("Explore the map")).toHaveCount(0);
  const filterSelector = page.getByLabel("Filter", { exact: true });
  const heatmapSelector = page.getByLabel("Heatmap", { exact: true });
  await expect(filterSelector.locator("option")).toHaveCount(3);
  await expect(heatmapSelector.locator("option")).toHaveCount(3);
  await expect(
    filterSelector.locator('option[value="nearby-parks/distance"]'),
  ).toHaveText("Nearby parks · Park distance");
  await expect(
    heatmapSelector.locator('option[value="nearby-parks/influence"]'),
  ).toHaveText("Nearby parks · Park influence");
  await expect(
    filterSelector.locator('option[value="commute/time"]'),
  ).toHaveText("Commute time · Commute time");
  await expect(
    heatmapSelector.locator('option[value="commute/travel-time"]'),
  ).toHaveText("Commute time · Commute time");
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

  await page
    .getByLabel("Filter", { exact: true })
    .selectOption("nearby-parks/distance");
  await expect(page.getByTestId("region-count")).toHaveText("2");
  await expect(page.getByText(/2 filter-owned regions/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Clear all" })).toBeDisabled();

  await page.getByRole("slider", { name: "Park distance" }).fill("0");
  await expect(page.getByTestId("region-count")).toHaveText("1");

  await page
    .getByLabel("Heatmap", { exact: true })
    .selectOption("nearby-parks/influence");
  await expect(page.getByTestId("map-active-summary")).toContainText(
    "Park influence2",
  );
  expect(parkRequests).toBe(1);

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
  await expect.poll(() => parkRequests).toBeGreaterThan(1);

  await page.getByRole("button", { name: "Remove Park distance" }).click();
  await expect(page.getByTestId("region-count")).toHaveText("0");
  await page.getByRole("button", { name: "Remove Park influence" }).click();
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

  const heatmapSelector = page.getByLabel("Heatmap", { exact: true });
  await heatmapSelector.selectOption("nearby-parks/influence");
  await heatmapSelector.selectOption("nearby-parks/influence");

  const removeButtons = page.getByRole("button", {
    name: "Remove Park influence",
  });
  await expect(removeButtons).toHaveCount(2);
  await expect(
    page.getByTestId("map-active-summary").getByText("Park influence"),
  ).toHaveCount(2);

  await removeButtons.first().click();
  await expect(removeButtons).toHaveCount(1);
});

test("draws and clears a polygon region", async ({ page }) => {
  await page.goto("/");

  const drawButton = page.getByRole("button", { name: "Draw region" });
  const selectButton = page.getByRole("button", { name: "Select & edit" });
  await expect(drawButton).toBeEnabled({ timeout: 15_000 });
  await drawButton.click();
  await expect(drawButton).toHaveAttribute("aria-pressed", "true");
  await expect(selectButton).toHaveAttribute("aria-pressed", "false");

  const overlay = page.getByTestId("draw-overlay");
  await expect(overlay).toHaveCSS("cursor", "crosshair");
  const box = await overlay.boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;

  const path = [
    [box.x + box.width * 0.55, box.y + box.height * 0.3],
    [box.x + box.width * 0.8, box.y + box.height * 0.3],
    [box.x + box.width * 0.8, box.y + box.height * 0.7],
    [box.x + box.width * 0.55, box.y + box.height * 0.7],
    [box.x + box.width * 0.55, box.y + box.height * 0.3],
  ] as const;
  await page.mouse.move(path[0][0], path[0][1]);
  await page.mouse.down();
  for (const [x, y] of path.slice(1, 3)) {
    await page.mouse.move(x, y, { steps: 12 });
  }
  await expect(page.getByTestId("draw-preview")).toBeVisible();
  await expect(page.getByTestId("region-count")).toHaveText("0");
  for (const [x, y] of path.slice(3)) {
    await page.mouse.move(x, y, { steps: 12 });
  }
  await page.mouse.up();

  await expect(page.getByTestId("draw-preview")).toHaveCount(0);
  await expect(page.getByTestId("region-count")).toHaveText("1");
  await expect(selectButton).toHaveAttribute("aria-pressed", "true");
  await page.addStyleTag({
    content:
      ".maplibregl-user-location-dot,.maplibregl-user-location-accuracy-circle{display:none!important}",
  });
  await expect(page).toHaveScreenshot("persisted-region.png", {
    animations: "disabled",
    clip: {
      x: box.x + box.width * 0.5,
      y: box.y + box.height * 0.25,
      width: box.width * 0.35,
      height: box.height * 0.5,
    },
    maxDiffPixelRatio: 0.01,
  });
  await page.getByRole("button", { name: "Clear all" }).click();
  await expect(page.getByTestId("region-count")).toHaveText("0");
});
