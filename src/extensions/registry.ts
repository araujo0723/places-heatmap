import type {
  FilterContribution,
  HeatmapContribution,
  MapExtension,
} from "./api";
import { contributionKey } from "./api";

export interface RegisteredFilter {
  key: string;
  extension: MapExtension;
  contribution: FilterContribution<any>;
}

export interface RegisteredHeatmap {
  key: string;
  extension: MapExtension;
  contribution: HeatmapContribution<any>;
}

export interface ExtensionRegistry {
  extensions: MapExtension[];
  filters: RegisteredFilter[];
  heatmaps: RegisteredHeatmap[];
  diagnostics: string[];
}

interface ExtensionModule {
  default?: unknown;
}

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validateContribution(
  contribution: unknown,
  kind: "filter" | "heatmap",
): contribution is FilterContribution<any> | HeatmapContribution<any> {
  if (!contribution || typeof contribution !== "object") return false;

  const candidate = contribution as Record<string, unknown>;
  if (!hasText(candidate.id) || !hasText(candidate.name)) return false;

  if (kind === "filter") {
    return (
      typeof candidate.Controls === "function" &&
      typeof candidate.resolvePredicate === "function"
    );
  }

  return (
    typeof candidate.load === "function" &&
    !!candidate.style &&
    typeof candidate.style === "object"
  );
}

function validateExtension(value: unknown): value is MapExtension {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;

  return (
    candidate.apiVersion === 1 &&
    hasText(candidate.id) &&
    hasText(candidate.name) &&
    (candidate.filters === undefined || Array.isArray(candidate.filters)) &&
    (candidate.heatmaps === undefined || Array.isArray(candidate.heatmaps))
  );
}

export function createExtensionRegistry(
  modules: Record<string, ExtensionModule | unknown>,
): ExtensionRegistry {
  const registry: ExtensionRegistry = {
    extensions: [],
    filters: [],
    heatmaps: [],
    diagnostics: [],
  };
  const extensionIds = new Set<string>();

  for (const [path, moduleValue] of Object.entries(modules).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const candidate =
      moduleValue && typeof moduleValue === "object" && "default" in moduleValue
        ? (moduleValue as ExtensionModule).default
        : undefined;

    if (!validateExtension(candidate)) {
      registry.diagnostics.push(
        `${path}: expected a default apiVersion 1 extension export.`,
      );
      continue;
    }

    if (extensionIds.has(candidate.id)) {
      registry.diagnostics.push(
        `${path}: duplicate extension id "${candidate.id}".`,
      );
      continue;
    }

    const contributionIds = new Set<string>();
    let valid = true;

    for (const contribution of candidate.filters ?? []) {
      if (!validateContribution(contribution, "filter")) {
        registry.diagnostics.push(
          `${path}: extension "${candidate.id}" has an invalid filter contribution.`,
        );
        valid = false;
        break;
      }
      if (contributionIds.has(contribution.id)) {
        registry.diagnostics.push(
          `${path}: extension "${candidate.id}" repeats contribution id "${contribution.id}".`,
        );
        valid = false;
        break;
      }
      contributionIds.add(contribution.id);
    }

    if (!valid) continue;

    for (const contribution of candidate.heatmaps ?? []) {
      if (!validateContribution(contribution, "heatmap")) {
        registry.diagnostics.push(
          `${path}: extension "${candidate.id}" has an invalid heatmap contribution.`,
        );
        valid = false;
        break;
      }
      if (contributionIds.has(contribution.id)) {
        registry.diagnostics.push(
          `${path}: extension "${candidate.id}" repeats contribution id "${contribution.id}".`,
        );
        valid = false;
        break;
      }
      contributionIds.add(contribution.id);
    }

    if (!valid) continue;

    extensionIds.add(candidate.id);
    registry.extensions.push(candidate);
    registry.filters.push(
      ...(candidate.filters ?? []).map((contribution) => ({
        key: contributionKey(candidate.id, contribution.id),
        extension: candidate,
        contribution,
      })),
    );
    registry.heatmaps.push(
      ...(candidate.heatmaps ?? []).map((contribution) => ({
        key: contributionKey(candidate.id, contribution.id),
        extension: candidate,
        contribution,
      })),
    );
  }

  return registry;
}

const extensionModules = import.meta.glob("./*/index.tsx", { eager: true });

export const extensionRegistry = createExtensionRegistry(extensionModules);

