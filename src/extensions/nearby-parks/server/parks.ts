import type { GeoBounds } from "../../../core/geo";
import { queryLocalOsm } from "../../../server/osm-pbf";
import type { ParkRecord } from "../core/parks";

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
