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

test("generates, filters, and removes random data in the focused area", async ({
  page,
}) => {
  await page.goto("/");

  await expect(page.getByTestId("location-status")).toHaveText(
    "Centered near you",
  );
  await expect(page.locator("astro-dev-toolbar")).toHaveCount(0);
  await expect(page.getByText("© OpenStreetMap contributors")).toBeVisible();
  await expect(page.getByText("No active filters")).toBeVisible();
  await expect(page.getByText("No active heatmaps")).toBeVisible();
  await expect(page.getByText("Places workspace")).toHaveCount(0);
  await expect(page.getByText("Explore the map")).toHaveCount(0);

  await page.getByLabel("Heatmap").selectOption("demo-places/density");
  await expect(page.getByTestId("map-active-summary")).toContainText(
    "Random heatmap140",
  );

  await page.getByLabel("Filter").selectOption("demo-places/minimum-weight");
  await expect(page.getByTestId("region-count")).toHaveText("3");
  await page
    .getByRole("slider", { name: "Random coverage" })
    .fill("10");
  await expect(page.getByTestId("map-active-summary")).not.toContainText(
    "Random heatmap140",
  );
  await page.getByRole("button", { name: "Clear all" }).click();
  await expect(page.getByTestId("region-count")).toHaveText("0");

  await page
    .getByRole("button", { name: "Remove Random area filter" })
    .click();
  await expect(page.getByTestId("map-active-summary")).toContainText(
    "Random heatmap140",
  );
  await expect(page.getByTestId("region-count")).toHaveText("0");
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

test("allows duplicate heatmap instances", async ({ page }) => {
  await page.goto("/");

  const heatmapSelector = page.getByLabel("Heatmap", { exact: true });
  await heatmapSelector.selectOption("demo-places/density");
  await heatmapSelector.selectOption("demo-places/density");

  const removeButtons = page.getByRole("button", {
    name: "Remove Random heatmap",
  });
  await expect(removeButtons).toHaveCount(2);
  await expect(
    page.getByTestId("map-active-summary").getByText("Random heatmap"),
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
