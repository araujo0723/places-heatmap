import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  parseSavedMapState,
  type SavedMapState,
} from "../core/saved-map";

const DEFAULT_DATABASE_PATH = ".data/places-heatmap.sqlite";
const MAP_ID_PATTERN = /^[A-Za-z0-9_-]{12,32}$/;

interface SavedMapRow {
  id: string;
  state_json: string;
  created_at: string;
  updated_at: string;
}

export interface StoredSavedMap {
  id: string;
  state: SavedMapState;
  createdAt: string;
  updatedAt: string;
}

export function isSavedMapId(value: string) {
  return MAP_ID_PATTERN.test(value);
}

export class SavedMapStore {
  private readonly database: DatabaseSync;

  constructor(databasePath: string) {
    const resolvedPath = resolve(databasePath);
    mkdirSync(dirname(resolvedPath), { recursive: true });
    this.database = new DatabaseSync(resolvedPath);
    this.database.exec("PRAGMA journal_mode = WAL");
    this.database.exec("PRAGMA busy_timeout = 5000");
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS saved_maps (
        id TEXT PRIMARY KEY,
        state_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }

  create(state: SavedMapState): StoredSavedMap {
    const serialized = JSON.stringify(parseSavedMapState(state));
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const id = randomBytes(12).toString("base64url");
      try {
        this.database
          .prepare("INSERT INTO saved_maps (id, state_json) VALUES (?, ?)")
          .run(id, serialized);
        return this.get(id) as StoredSavedMap;
      } catch (error) {
        if (
          !(error instanceof Error) ||
          !error.message.includes("UNIQUE constraint failed")
        ) {
          throw error;
        }
      }
    }
    throw new Error("Could not allocate a unique saved map ID.");
  }

  get(id: string): StoredSavedMap | undefined {
    if (!isSavedMapId(id)) return undefined;
    const row = this.database
      .prepare(
        "SELECT id, state_json, created_at, updated_at FROM saved_maps WHERE id = ?",
      )
      .get(id) as unknown as SavedMapRow | undefined;
    if (!row) return undefined;
    return {
      id: row.id,
      state: parseSavedMapState(JSON.parse(row.state_json)),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  update(id: string, state: SavedMapState): StoredSavedMap | undefined {
    if (!isSavedMapId(id)) return undefined;
    const serialized = JSON.stringify(parseSavedMapState(state));
    const result = this.database
      .prepare(
        `UPDATE saved_maps
         SET state_json = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      )
      .run(serialized, id);
    if (Number(result.changes) === 0) return undefined;
    return this.get(id);
  }

  close() {
    this.database.close();
  }
}

let defaultStore: SavedMapStore | undefined;

export function getSavedMapStore() {
  defaultStore ??= new SavedMapStore(
    process.env.PLACES_HEATMAP_DB_PATH ?? DEFAULT_DATABASE_PATH,
  );
  return defaultStore;
}
