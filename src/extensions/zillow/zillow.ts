import type { ZillowCoordinate, ZillowPolygon } from "./geometry";
import { preparePolygonsForZillow } from "./geometry";

export interface ZillowBounds {
  west: number;
  east: number;
  south: number;
  north: number;
}

const zillowRegionMutation = `mutation SaveCustomRegion($customRegionToSave: SaveCustomRegionInput!) {
  saveCustomRegion(customRegionToSave: $customRegionToSave) {
    polygon
    customRegionId
  }
}`;

export function buildZillowCustomRegionPolygon(
  polygons: ReadonlyArray<ReadonlyArray<ZillowCoordinate>>,
) {
  return preparePolygonsForZillow(polygons)
    .map((polygon) => {
      const points = polygon.slice(0, -1);
      const serialized = points.map(
        ([longitude, latitude]) => `${latitude},${longitude}`,
      );
      return [...serialized, serialized[0]].join("|");
    })
    .join(":");
}

export function buildZillowRegionSaveRequest(
  polygons: ReadonlyArray<ReadonlyArray<ZillowCoordinate>>,
) {
  return {
    operationName: "SaveCustomRegion",
    variables: {
      customRegionToSave: {
        convertToWkt: true,
        polygon: buildZillowCustomRegionPolygon(polygons),
      },
    },
    query: zillowRegionMutation,
  };
}

export function getBoundsForPolygons(
  polygons: ReadonlyArray<ZillowPolygon>,
): ZillowBounds | undefined {
  const first = polygons[0]?.[0];
  if (!first) return undefined;

  const bounds: ZillowBounds = {
    west: first[0],
    east: first[0],
    south: first[1],
    north: first[1],
  };
  for (const polygon of polygons) {
    for (const [longitude, latitude] of polygon) {
      bounds.west = Math.min(bounds.west, longitude);
      bounds.east = Math.max(bounds.east, longitude);
      bounds.south = Math.min(bounds.south, latitude);
      bounds.north = Math.max(bounds.north, latitude);
    }
  }
  return bounds;
}

export function buildZillowRentalUrl(
  bounds: ZillowBounds,
  customRegionId: string,
  userPosition: ZillowCoordinate,
) {
  const url = new URL("https://www.zillow.com/homes/for_rent/");
  url.searchParams.set(
    "userPosition",
    `${userPosition[0]},${userPosition[1]}`,
  );
  url.searchParams.set(
    "userPositionBounds",
    `${userPosition[1] + 0.005},${userPosition[0] + 0.005},${userPosition[1] - 0.005},${userPosition[0] - 0.005}`,
  );
  url.searchParams.set("currentLocationSearch", "true");
  url.searchParams.set(
    "searchQueryState",
    JSON.stringify({
      pagination: {},
      isMapVisible: true,
      mapBounds: bounds,
      filterState: {
        fr: { value: true },
        fsba: { value: false },
        fsbo: { value: false },
        nc: { value: false },
        cmsn: { value: false },
        auc: { value: false },
        fore: { value: false },
      },
      isListVisible: true,
      mapZoom: 12,
      customRegionId,
    }),
  );
  return url.toString();
}
