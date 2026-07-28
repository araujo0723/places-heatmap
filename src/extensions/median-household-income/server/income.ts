import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";
import type { MultiPolygon, Polygon } from "geojson";
import type { GeoBounds } from "../../../core/geo";
import {
  incomeWeight,
  type IncomeCollection,
  type IncomeProperties,
} from "../core/income";

const DEFAULT_DATABASE_PATH =
  "src/extensions/median-household-income/data/median-household-income.sqlite";

interface IncomeDatabaseRow {
  geoid: unknown;
  name: unknown;
  income: unknown;
  margin_of_error: unknown;
  geometry_json: unknown;
}

export interface IncomeServiceDependencies {
  databasePath?: string;
  query?: (bounds: GeoBounds) => IncomeCollection | Promise<IncomeCollection>;
}

export class IncomeStore {
  private readonly database: DatabaseSync;

  constructor(databasePath = DEFAULT_DATABASE_PATH) {
    const path = resolve(databasePath);
    try {
      this.database = new DatabaseSync(path, { readOnly: true });
      this.database.exec("PRAGMA query_only = ON");
    } catch (error) {
      throw new Error(
        `Median household income index could not be opened at ${path}. ` +
          "Run npm run index:income.",
        { cause: error },
      );
    }
  }

  query(bounds: GeoBounds): IncomeCollection {
    const rows = this.database
      .prepare(
        `
          SELECT
            block_groups.geoid,
            block_groups.name,
            block_groups.income,
            block_groups.margin_of_error,
            block_groups.geometry_json
          FROM income_block_group_bounds AS bounds
          INNER JOIN income_block_groups AS block_groups
            ON block_groups.id = bounds.id
          WHERE bounds.west <= ?
            AND bounds.east >= ?
            AND bounds.south <= ?
            AND bounds.north >= ?
          ORDER BY block_groups.geoid
        `,
      )
      .all(
        bounds.east,
        bounds.west,
        bounds.north,
        bounds.south,
      ) as unknown as IncomeDatabaseRow[];

    return {
      type: "FeatureCollection",
      features: rows.map((row, index) => {
        if (
          typeof row.geoid !== "string" ||
          typeof row.name !== "string" ||
          typeof row.income !== "number" ||
          !Number.isFinite(row.income) ||
          (row.margin_of_error !== null &&
            (typeof row.margin_of_error !== "number" ||
              !Number.isFinite(row.margin_of_error))) ||
          typeof row.geometry_json !== "string"
        ) {
          throw new Error(`Income index row ${index + 1} is malformed.`);
        }
        const geometry = JSON.parse(row.geometry_json) as
          | Polygon
          | MultiPolygon;
        if (
          (geometry.type !== "Polygon" &&
            geometry.type !== "MultiPolygon") ||
          !Array.isArray(geometry.coordinates)
        ) {
          throw new Error(
            `Income index geometry ${index + 1} is malformed.`,
          );
        }
        const properties: IncomeProperties = {
          geoid: row.geoid,
          name: row.name,
          income: row.income,
          weight: incomeWeight(row.income),
          ...(row.margin_of_error === null
            ? {}
            : { marginOfError: row.margin_of_error }),
        };
        return {
          type: "Feature" as const,
          id: row.geoid,
          geometry,
          properties,
        };
      }),
    };
  }

  close() {
    this.database.close();
  }
}

let defaultStore: IncomeStore | undefined;

function store() {
  defaultStore ??= new IncomeStore();
  return defaultStore;
}

export async function getIncomeForBounds(
  bounds: GeoBounds,
  dependencies: IncomeServiceDependencies = {},
): Promise<IncomeCollection> {
  if (dependencies.query) return dependencies.query(bounds);
  if (dependencies.databasePath) {
    const scopedStore = new IncomeStore(dependencies.databasePath);
    try {
      return scopedStore.query(bounds);
    } finally {
      scopedStore.close();
    }
  }
  return store().query(bounds);
}

export function clearIncomeStore() {
  defaultStore?.close();
  defaultStore = undefined;
}
