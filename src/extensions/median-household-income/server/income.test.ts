// @vitest-environment node

import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { vi } from "vitest";
import type { GeoBounds } from "../../../core/geo";
import { getIncomeForBounds, IncomeStore } from "./income";

const bounds: GeoBounds = {
  west: -84.55,
  south: 33.6,
  east: -84.23,
  north: 33.9,
};

function polygon(west: number, south: number) {
  return {
    type: "Polygon" as const,
    coordinates: [
      [
        [west, south],
        [west + 0.1, south],
        [west + 0.1, south + 0.1],
        [west, south + 0.1],
        [west, south],
      ],
    ],
  };
}

function createFixtureDatabase(path: string) {
  const database = new DatabaseSync(path);
  database.exec(`
    CREATE TABLE income_block_groups (
      id INTEGER PRIMARY KEY,
      geoid TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      income INTEGER NOT NULL,
      margin_of_error INTEGER,
      geometry_json TEXT NOT NULL
    );
    CREATE VIRTUAL TABLE income_block_group_bounds USING rtree(
      id,
      west,
      east,
      south,
      north
    );
  `);
  const insert = database.prepare(`
    INSERT INTO income_block_groups (
      geoid,
      name,
      income,
      margin_of_error,
      geometry_json
    ) VALUES (?, ?, ?, ?, ?)
  `);
  const insertBounds = database.prepare(`
    INSERT INTO income_block_group_bounds (
      id,
      west,
      east,
      south,
      north
    ) VALUES (?, ?, ?, ?, ?)
  `);

  const inside = insert.run(
    "131210001001",
    "Block Group 1",
    75_000,
    5_000,
    JSON.stringify(polygon(-84.4, 33.7)),
  );
  insertBounds.run(
    Number(inside.lastInsertRowid),
    -84.4,
    -84.3,
    33.7,
    33.8,
  );
  const outside = insert.run(
    "130010001001",
    "Distant block group",
    50_000,
    null,
    JSON.stringify(polygon(-82, 31)),
  );
  insertBounds.run(
    Number(outside.lastInsertRowid),
    -82,
    -81.9,
    31,
    31.1,
  );
  database.close();
}

describe("median household income service", () => {
  let directory: string;
  let databasePath: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "income-store-test-"));
    databasePath = join(directory, "income.sqlite");
    createFixtureDatabase(databasePath);
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("queries only locally intersecting block groups from SQLite", async () => {
    const collection = await getIncomeForBounds(bounds, { databasePath });

    expect(collection.features).toHaveLength(1);
    expect(collection.features[0]).toMatchObject({
      id: "131210001001",
      properties: {
        geoid: "131210001001",
        income: 75_000,
        marginOfError: 5_000,
        weight: 0.25,
      },
    });
  });

  it("passes the complete Area of Interest to an injected query", async () => {
    const query = vi.fn(async () => ({
      type: "FeatureCollection" as const,
      features: [],
    }));

    await expect(
      getIncomeForBounds(bounds, { query }),
    ).resolves.toEqual({
      type: "FeatureCollection",
      features: [],
    });
    expect(query).toHaveBeenCalledWith(bounds);
  });

  it("reports a missing canonical database", () => {
    expect(
      () => new IncomeStore(join(directory, "missing.sqlite")),
    ).toThrow("Canonical median household income database could not be opened");
  });
});
