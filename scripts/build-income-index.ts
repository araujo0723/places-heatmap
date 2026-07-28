import { DatabaseSync } from "node:sqlite";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import AdmZip from "adm-zip";
import type {
  Feature,
  MultiPolygon,
  Polygon,
  Position,
} from "geojson";
import * as shapefile from "shapefile";

interface IncomeRow {
  name: string;
  income: number;
  marginOfError?: number;
}

interface CliOptions {
  csvPath: string;
  tigerPath: string;
  targetPath: string;
}

interface ShapeProperties {
  GEOID: string;
}

type BlockGroupFeature = Feature<Polygon | MultiPolygon, ShapeProperties>;

const DEFAULT_CSV_PATH = "ACSDT5Y2024.B19013-Data.csv";
const DEFAULT_TIGER_PATH = "tl_2024_13_bg.zip";
const DEFAULT_TARGET_PATH =
  "src/extensions/median-household-income/data/median-household-income.sqlite";

function cliOptions(arguments_: string[]): CliOptions {
  const values = new Map<string, string>();
  for (let index = 0; index < arguments_.length; index += 2) {
    const key = arguments_[index];
    const value = arguments_[index + 1];
    if (!key?.startsWith("--") || !value) {
      throw new Error(
        "Expected --csv, --tiger, or --target followed by a path.",
      );
    }
    values.set(key, value);
  }
  return {
    csvPath: resolve(values.get("--csv") ?? DEFAULT_CSV_PATH),
    tigerPath: resolve(values.get("--tiger") ?? DEFAULT_TIGER_PATH),
    targetPath: resolve(values.get("--target") ?? DEFAULT_TARGET_PATH),
  };
}

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      fields.push(field);
      field = "";
    } else {
      field += character;
    }
  }
  fields.push(field);
  return fields;
}

function optionalNumber(value: string) {
  const number = Number(value);
  return value.trim() && Number.isFinite(number) && number >= 0
    ? number
    : undefined;
}

function parseIncomeRows(contents: string) {
  const lines = contents.replace(/^\uFEFF/, "").split(/\r?\n/);
  const headers = parseCsvLine(lines[0] ?? "");
  const geoidIndex = headers.indexOf("GEO_ID");
  const nameIndex = headers.indexOf("NAME");
  const incomeIndex = headers.indexOf("B19013_001E");
  const marginIndex = headers.indexOf("B19013_001M");
  if (
    geoidIndex < 0 ||
    nameIndex < 0 ||
    incomeIndex < 0 ||
    marginIndex < 0
  ) {
    throw new Error(
      "The source income table is missing GEO_ID, NAME, B19013_001E, or B19013_001M.",
    );
  }

  const rows = new Map<string, IncomeRow>();
  for (const line of lines.slice(2)) {
    if (!line.trim()) continue;
    const fields = parseCsvLine(line);
    const geoid = fields[geoidIndex]?.match(/US(\d{12})$/)?.[1];
    const income = optionalNumber(fields[incomeIndex] ?? "");
    if (!geoid || income === undefined) continue;
    const marginOfError = optionalNumber(fields[marginIndex] ?? "");
    rows.set(geoid, {
      name: fields[nameIndex] ?? geoid,
      income,
      ...(marginOfError === undefined ? {} : { marginOfError }),
    });
  }
  return rows;
}

function roundedPosition(position: Position): Position {
  return [
    Number(position[0].toFixed(6)),
    Number(position[1].toFixed(6)),
  ];
}

function roundedRing(ring: Position[]): Position[] {
  const rounded = ring
    .map(roundedPosition)
    .filter(
      (position, index, positions) =>
        index === 0 ||
        position[0] !== positions[index - 1][0] ||
        position[1] !== positions[index - 1][1],
    );
  if (
    rounded.length > 0 &&
    (rounded[0][0] !== rounded[rounded.length - 1][0] ||
      rounded[0][1] !== rounded[rounded.length - 1][1])
  ) {
    rounded.push([...rounded[0]]);
  }
  return rounded;
}

function roundedGeometry(
  geometry: Polygon | MultiPolygon,
): Polygon | MultiPolygon {
  return geometry.type === "Polygon"
    ? {
        type: "Polygon",
        coordinates: geometry.coordinates.map(roundedRing),
      }
    : {
        type: "MultiPolygon",
        coordinates: geometry.coordinates.map((polygon) =>
          polygon.map(roundedRing),
        ),
      };
}

function geometryBounds(geometry: Polygon | MultiPolygon) {
  const positions =
    geometry.type === "Polygon"
      ? geometry.coordinates.flat()
      : geometry.coordinates.flat(2);
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const position of positions) {
    west = Math.min(west, position[0]);
    south = Math.min(south, position[1]);
    east = Math.max(east, position[0]);
    north = Math.max(north, position[1]);
  }
  if (![west, south, east, north].every(Number.isFinite)) {
    throw new Error("A TIGER block group has invalid coordinates.");
  }
  return { west, south, east, north };
}

function isBlockGroupFeature(value: unknown): value is BlockGroupFeature {
  if (!value || typeof value !== "object") return false;
  const feature = value as Partial<BlockGroupFeature>;
  return (
    feature.type === "Feature" &&
    (feature.geometry?.type === "Polygon" ||
      feature.geometry?.type === "MultiPolygon") &&
    typeof feature.properties?.GEOID === "string"
  );
}

async function buildIndex(options: CliOptions) {
  const incomeRows = parseIncomeRows(await readFile(options.csvPath, "utf8"));
  const temporaryDirectory = await mkdtemp(
    join(tmpdir(), "places-income-index-"),
  );

  try {
    new AdmZip(options.tigerPath).extractAllTo(temporaryDirectory, true);
    const archiveStem = basename(options.tigerPath, ".zip");
    const shapePath = join(temporaryDirectory, `${archiveStem}.shp`);
    const dbfPath = join(temporaryDirectory, `${archiveStem}.dbf`);

    await mkdir(dirname(options.targetPath), { recursive: true });
    await rm(options.targetPath, { force: true });
    const database = new DatabaseSync(options.targetPath);
    database.exec(`
      PRAGMA journal_mode = OFF;
      PRAGMA synchronous = OFF;
      PRAGMA temp_store = MEMORY;
      CREATE TABLE metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      ) WITHOUT ROWID;
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

    const insertBlockGroup = database.prepare(`
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
    const insertMetadata = database.prepare(
      "INSERT INTO metadata (key, value) VALUES (?, ?)",
    );
    const source = await shapefile.open(shapePath, dbfPath, {
      encoding: "utf-8",
    });
    let indexedCount = 0;
    let shapeCount = 0;

    database.exec("BEGIN");
    try {
      while (true) {
        const result = await source.read();
        if (result.done) break;
        shapeCount += 1;
        if (!isBlockGroupFeature(result.value)) {
          throw new Error(`TIGER feature ${shapeCount} is malformed.`);
        }
        const geoid = result.value.properties.GEOID;
        const incomeRow = incomeRows.get(geoid);
        if (!incomeRow) continue;
        const geometry = roundedGeometry(result.value.geometry);
        const bounds = geometryBounds(geometry);
        const inserted = insertBlockGroup.run(
          geoid,
          incomeRow.name,
          incomeRow.income,
          incomeRow.marginOfError ?? null,
          JSON.stringify(geometry),
        );
        insertBounds.run(
          Number(inserted.lastInsertRowid),
          bounds.west,
          bounds.east,
          bounds.south,
          bounds.north,
        );
        indexedCount += 1;
      }
      insertMetadata.run("schema_version", "1");
      insertMetadata.run("acs_vintage", "2024");
      insertMetadata.run("acs_table", "B19013");
      insertMetadata.run("tiger_vintage", "2024");
      insertMetadata.run("state_fips", "13");
      insertMetadata.run("feature_count", String(indexedCount));
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }

    database.exec(`
      CREATE INDEX income_block_groups_income
        ON income_block_groups (income);
      ANALYZE;
      VACUUM;
      PRAGMA query_only = ON;
    `);
    database.close();
    console.log(
      `Indexed ${indexedCount.toLocaleString()} income block groups from ` +
        `${shapeCount.toLocaleString()} TIGER features into ${options.targetPath}.`,
    );
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

await buildIndex(cliOptions(process.argv.slice(2)));
