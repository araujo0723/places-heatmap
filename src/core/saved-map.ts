export const SAVED_MAP_VERSION = 1 as const;

export interface SavedMapLocation {
  longitude: number;
  latitude: number;
}

export interface SavedMapContribution {
  instanceId: string;
  contribution: string;
  parameters: unknown;
  enabled: boolean;
  randomSeed: number;
}

export interface SavedMapState {
  version: typeof SAVED_MAP_VERSION;
  startingLocation: SavedMapLocation | null;
  filters: SavedMapContribution[];
  heatmaps: SavedMapContribution[];
}

export class SavedMapValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SavedMapValidationError";
  }
}

function isFiniteCoordinate(value: unknown, minimum: number, maximum: number) {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= minimum &&
    value <= maximum
  );
}

function assertContribution(
  value: unknown,
  kind: "filter" | "heatmap",
  index: number,
): asserts value is SavedMapContribution {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new SavedMapValidationError(
      `Saved ${kind} ${index + 1} must be an object.`,
    );
  }
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.instanceId !== "string" ||
    candidate.instanceId.length < 1 ||
    candidate.instanceId.length > 100
  ) {
    throw new SavedMapValidationError(
      `Saved ${kind} ${index + 1} has an invalid instance ID.`,
    );
  }
  if (
    typeof candidate.contribution !== "string" ||
    candidate.contribution.length < 1 ||
    candidate.contribution.length > 200
  ) {
    throw new SavedMapValidationError(
      `Saved ${kind} ${index + 1} has an invalid contribution key.`,
    );
  }
  if (candidate.parameters === undefined) {
    throw new SavedMapValidationError(
      `Saved ${kind} ${index + 1} is missing its parameters.`,
    );
  }
  if (typeof candidate.enabled !== "boolean") {
    throw new SavedMapValidationError(
      `Saved ${kind} ${index + 1} has an invalid enabled state.`,
    );
  }
  if (
    typeof candidate.randomSeed !== "number" ||
    !Number.isSafeInteger(candidate.randomSeed) ||
    candidate.randomSeed < 0 ||
    candidate.randomSeed > 2_147_483_647
  ) {
    throw new SavedMapValidationError(
      `Saved ${kind} ${index + 1} has an invalid random seed.`,
    );
  }
}

export function parseSavedMapState(value: unknown): SavedMapState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new SavedMapValidationError("Saved map state must be an object.");
  }
  const candidate = value as Record<string, unknown>;
  if (candidate.version !== SAVED_MAP_VERSION) {
    throw new SavedMapValidationError(
      `Unsupported saved map version: ${String(candidate.version)}.`,
    );
  }

  if (candidate.startingLocation !== null) {
    const location = candidate.startingLocation;
    if (!location || typeof location !== "object" || Array.isArray(location)) {
      throw new SavedMapValidationError(
        "The saved starting location is invalid.",
      );
    }
    const coordinates = location as Record<string, unknown>;
    if (
      !isFiniteCoordinate(coordinates.longitude, -180, 180) ||
      !isFiniteCoordinate(coordinates.latitude, -85.051129, 85.051129)
    ) {
      throw new SavedMapValidationError(
        "The saved starting location is invalid.",
      );
    }
  }

  if (!Array.isArray(candidate.filters) || candidate.filters.length > 100) {
    throw new SavedMapValidationError(
      "Saved filters must be an array of at most 100 entries.",
    );
  }
  if (!Array.isArray(candidate.heatmaps) || candidate.heatmaps.length > 100) {
    throw new SavedMapValidationError(
      "Saved heatmaps must be an array of at most 100 entries.",
    );
  }
  candidate.filters.forEach((filter, index) =>
    assertContribution(filter, "filter", index),
  );
  candidate.heatmaps.forEach((heatmap, index) =>
    assertContribution(heatmap, "heatmap", index),
  );

  const instanceIds = new Set<string>();
  for (const contribution of [
    ...candidate.filters,
    ...candidate.heatmaps,
  ] as SavedMapContribution[]) {
    if (instanceIds.has(contribution.instanceId)) {
      throw new SavedMapValidationError(
        `Duplicate saved instance ID: ${contribution.instanceId}.`,
      );
    }
    instanceIds.add(contribution.instanceId);
  }

  return candidate as unknown as SavedMapState;
}
