import { createExtensionRegistry } from "./registry";

function Controls() {
  return null;
}

function validExtension(id: string) {
  return {
    apiVersion: 1,
    id,
    name: `Extension ${id}`,
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
  it("registers valid filter and heatmap contributions", () => {
    const registry = createExtensionRegistry({
      "./alpha/index.tsx": { default: validExtension("alpha") },
    });

    expect(registry.extensions).toHaveLength(1);
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

  it("rejects contribution IDs repeated across filter and heatmap lists", () => {
    const candidate = validExtension("repeated");
    candidate.heatmaps[0].id = "filter";
    const registry = createExtensionRegistry({
      "./repeated/index.tsx": { default: candidate },
    });

    expect(registry.extensions).toEqual([]);
    expect(registry.diagnostics[0]).toContain("repeats contribution id");
  });
});

