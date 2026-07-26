import type { GeoBounds } from "../../../core/geo";
import { queryLocalOsm } from "../../../server/osm-pbf";
import type { WaterRecord } from "../core/water";

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
