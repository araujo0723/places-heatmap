// @vitest-environment node

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SAVED_MAP_VERSION,
  type SavedMapState,
} from "../core/saved-map";
import { SavedMapStore, isSavedMapId } from "./saved-maps";

function state(distance: number): SavedMapState {
  return {
    version: SAVED_MAP_VERSION,
    startingLocation: { longitude: -84.388, latitude: 33.749 },
    filters: [
      {
        instanceId: "filter-1",
        contribution: "nearby-parks/distance",
        parameters: { distance },
        enabled: true,
        randomSeed: 123,
      },
    ],
    heatmaps: [],
  };
}

describe("SavedMapStore", () => {
  let directory: string;
  let store: SavedMapStore;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "places-heatmap-saved-maps-"));
    store = new SavedMapStore(join(directory, "maps.sqlite"));
  });

  afterEach(() => {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it("creates, reads, and updates saved JSON in SQLite", () => {
    const created = store.create(state(300));
    expect(isSavedMapId(created.id)).toBe(true);
    expect(store.get(created.id)?.state).toEqual(state(300));

    const updated = store.update(created.id, state(900));
    expect(updated?.id).toBe(created.id);
    expect(store.get(created.id)?.state.filters[0].parameters).toEqual({
      distance: 900,
    });
  });

  it("does not create missing maps during update", () => {
    expect(store.update("missing-map1", state(300))).toBeUndefined();
    expect(store.get("not-valid")).toBeUndefined();
  });
});
