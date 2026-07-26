import { createExtensionApiRegistry } from "./server-registry";

describe("extension API registry", () => {
  it("maps extension page modules to their public API routes", () => {
    const parks = { GET: () => Response.json({ parks: [] }) };
    const isochrones = { POST: () => Response.json({ features: [] }) };

    const registry = createExtensionApiRegistry({
      "./nearby-parks/pages/api/parks.ts": parks,
      "./commute/pages/api/commute/isochrones.ts": isochrones,
    });

    expect(registry.routes.get("/api/parks")).toBe(parks);
    expect(registry.routes.get("/api/commute/isochrones")).toBe(
      isochrones,
    );
    expect(registry.diagnostics).toEqual([]);
  });

  it("does not expose duplicate or invalid route modules", () => {
    const registry = createExtensionApiRegistry({
      "./alpha/pages/api/shared.ts": { GET: () => new Response() },
      "./beta/pages/api/shared.ts": { POST: () => new Response() },
      "./broken/pages/api/broken.ts": {},
    });

    expect(registry.routes.has("/api/shared")).toBe(false);
    expect(registry.routes.has("/api/broken")).toBe(false);
    expect(registry.diagnostics).toEqual([
      expect.stringContaining("duplicate extension API route"),
      expect.stringContaining("expected an API route handler"),
    ]);
  });
});
