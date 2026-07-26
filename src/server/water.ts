import type { GeoBounds } from "../core/geo";
import type { WaterRecord } from "../core/water";
import { queryLocalOsm } from "./osm-pbf";

export interface WaterServiceDependencies {
  pbfPath?: string;
  query?: (
    bounds: GeoBounds,
    pbfPath?: string,
  ) => Promise<WaterRecord[]>;
}

export function getWaterForBounds(
  bounds: GeoBounds,
  dependencies: WaterServiceDependencies = {},
) {
  return (
    dependencies.query ??
    ((queryBounds, pbfPath) =>
      queryLocalOsm("waters", queryBounds, pbfPath))
  )(bounds, dependencies.pbfPath);
}
