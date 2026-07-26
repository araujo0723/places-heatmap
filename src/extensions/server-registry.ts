import type { APIContext, APIRoute } from "astro";

type RouteMethod =
  | "DELETE"
  | "GET"
  | "HEAD"
  | "OPTIONS"
  | "PATCH"
  | "POST"
  | "PUT"
  | "ALL";

type ExtensionApiModule = Partial<Record<RouteMethod, APIRoute>>;

export interface ExtensionApiRegistry {
  routes: Map<string, ExtensionApiModule>;
  diagnostics: string[];
}

const ROUTE_METHODS: RouteMethod[] = [
  "DELETE",
  "GET",
  "HEAD",
  "OPTIONS",
  "PATCH",
  "POST",
  "PUT",
  "ALL",
];

function publicRoute(modulePath: string) {
  const match = modulePath.match(
    /^\.\/[^/]+\/pages\/(api\/.+)\.(?:ts|js)$/,
  );
  if (!match || /\.test\.[^.]+$/.test(modulePath)) return;

  const segments = match[1].split("/");
  const filename = segments.pop();
  if (!filename) return;
  if (filename !== "index") segments.push(filename);
  return `/${segments.join("/")}`;
}

export function createExtensionApiRegistry(
  modules: Record<string, unknown>,
): ExtensionApiRegistry {
  const registry: ExtensionApiRegistry = {
    routes: new Map(),
    diagnostics: [],
  };
  const conflictedRoutes = new Set<string>();

  for (const [modulePath, moduleValue] of Object.entries(modules).sort(
    ([first], [second]) => first.localeCompare(second),
  )) {
    const route = publicRoute(modulePath);
    if (!route) {
      registry.diagnostics.push(
        `${modulePath}: expected an extension page under pages/api.`,
      );
      continue;
    }
    if (registry.routes.has(route) || conflictedRoutes.has(route)) {
      registry.routes.delete(route);
      conflictedRoutes.add(route);
      registry.diagnostics.push(
        `${modulePath}: duplicate extension API route "${route}".`,
      );
      continue;
    }
    if (!moduleValue || typeof moduleValue !== "object") {
      registry.diagnostics.push(
        `${modulePath}: expected an API route module.`,
      );
      continue;
    }
    const candidate = moduleValue as ExtensionApiModule;
    if (
      !ROUTE_METHODS.some(
        (method) => typeof candidate[method] === "function",
      )
    ) {
      registry.diagnostics.push(
        `${modulePath}: expected an API route handler export.`,
      );
      continue;
    }
    registry.routes.set(route, candidate);
  }

  return registry;
}

const extensionApiModules = import.meta.glob(
  "./*/pages/api/**/*.{ts,js}",
  { eager: true },
);

export const extensionApiRegistry = createExtensionApiRegistry(
  extensionApiModules,
);

export async function dispatchExtensionApiRoute(
  context: APIContext,
): Promise<Response> {
  const pathname = new URL(context.request.url).pathname.replace(/\/+$/, "");
  const route = extensionApiRegistry.routes.get(pathname);
  if (!route) {
    return Response.json(
      { error: "Extension API route not found." },
      { status: 404 },
    );
  }

  const method = context.request.method.toUpperCase() as RouteMethod;
  const handler =
    route[method] ??
    (method === "HEAD" ? route.GET : undefined) ??
    route.ALL;
  if (!handler) {
    const allowed = ROUTE_METHODS.filter(
      (candidate) =>
        candidate !== "ALL" && typeof route[candidate] === "function",
    );
    return Response.json(
      { error: "Method not allowed." },
      {
        status: 405,
        headers: allowed.length ? { Allow: allowed.join(", ") } : undefined,
      },
    );
  }

  return handler(context);
}
