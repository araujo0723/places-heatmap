import type { GeoBounds } from "../core/geo";
import type { ParkRecord } from "../core/parks";
import { queryLocalOsm } from "./osm-pbf";

export interface ParkServiceDependencies {
  pbfPath?: string;
  query?: (
    bounds: GeoBounds,
    pbfPath?: string,
  ) => Promise<ParkRecord[]>;
}

export function getParksForBounds(
  bounds: GeoBounds,
  dependencies: ParkServiceDependencies = {},
) {
  return (
    dependencies.query ??
    ((queryBounds, pbfPath) =>
      queryLocalOsm("parks", queryBounds, pbfPath))
  )(bounds, dependencies.pbfPath);
}
