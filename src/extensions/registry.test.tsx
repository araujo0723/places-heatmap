import { createExtensionRegistry } from "./registry";

function Controls() {
  return null;
}

function validExtension(id: string) {
  return {
    apiVersion: 1,
    id,
    name: `Extension ${id}`,
    actions: [
      {
        id: "action",
        name: "Action",
        Controls,
      },
    ],
    filters: [
      {
        id: "filter",
        name: "Filter",
        initialState: {},
        Controls,
        resolvePredicate: () => () => true,
      },
    ],
    heatmaps: [
      {
        id: "heatmap",
        name: "Heatmap",
        initialState: {},
        load: async () => ({ type: "FeatureCollection", features: [] }),
        style: {},
      },
    ],
  };
}

describe("extension registry", () => {
  it("registers valid action, filter, and heatmap contributions", () => {
    const registry = createExtensionRegistry({
      "./alpha/index.tsx": { default: validExtension("alpha") },
    });

    expect(registry.extensions).toHaveLength(1);
    expect(registry.actions[0].key).toBe("alpha/action");
    expect(registry.filters[0].key).toBe("alpha/filter");
    expect(registry.heatmaps[0].key).toBe("alpha/heatmap");
    expect(registry.diagnostics).toEqual([]);
  });

  it("rejects unsupported APIs and duplicate extension IDs", () => {
    const registry = createExtensionRegistry({
      "./old/index.tsx": {
        default: { ...validExtension("old"), apiVersion: 2 },
      },
      "./one/index.tsx": { default: validExtension("same") },
      "./two/index.tsx": { default: validExtension("same") },
    });

    expect(registry.extensions).toHaveLength(1);
    expect(registry.diagnostics).toEqual(
      expect.arrayContaining([
        expect.stringContaining("apiVersion 1"),
        expect.stringContaining("duplicate extension id"),
      ]),
    );
  });

  it("rejects contribution IDs repeated across contribution lists", () => {
    const candidate = validExtension("repeated");
    candidate.heatmaps[0].id = "action";
    const registry = createExtensionRegistry({
      "./repeated/index.tsx": { default: candidate },
    });

    expect(registry.extensions).toEqual([]);
    expect(registry.diagnostics[0]).toContain("repeats contribution id");
  });

  it("accepts region-only filters and surface heatmaps", () => {
    const extension = validExtension("geometries");
    extension.filters[0] = {
      id: "regions",
      name: "Regions",
      initialState: {},
      Controls,
      resolveRegions: () => ({
        collection: { type: "FeatureCollection", features: [] },
        itemCount: 0,
      }),
    } as never;
    extension.heatmaps[0] = {
      kind: "surface",
      id: "surface",
      name: "Surface",
      initialState: {},
      load: async () => ({
        collection: { type: "FeatureCollection", features: [] },
        itemCount: 0,
      }),
      style: {},
    } as never;

    const registry = createExtensionRegistry({
      "./geometries/index.tsx": { default: extension },
    });
    expect(registry.filters).toHaveLength(1);
    expect(registry.heatmaps).toHaveLength(1);
    expect(registry.diagnostics).toEqual([]);
  });
});
