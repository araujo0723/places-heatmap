import type { MapViewport } from "../extensions/api";

export interface GeoBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

export interface MapTile {
  z: number;
  x: number;
  y: number;
}

export const NEARBY_AREA_TILE_ZOOM = 11;
export const PARK_TILE_ZOOM = NEARBY_AREA_TILE_ZOOM;
const EARTH_RADIUS_METERS = 6_371_008.8;
const MAX_MERCATOR_LATITUDE = 85.05112878;

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function normalizeLongitude(longitude: number) {
  const normalized = ((longitude + 180) % 360 + 360) % 360 - 180;
  return normalized === -180 && longitude > 0 ? 180 : normalized;
}

export function expandBoundsByMeters(
  bounds: GeoBounds,
  meters: number,
): GeoBounds {
  const latitudeDelta =
    (Math.max(0, meters) / EARTH_RADIUS_METERS) * (180 / Math.PI);
  const middleLatitude = clamp(
    (bounds.south + bounds.north) / 2,
    -MAX_MERCATOR_LATITUDE,
    MAX_MERCATOR_LATITUDE,
  );
  const longitudeScale = Math.max(
    Math.cos((middleLatitude * Math.PI) / 180),
    0.000001,
  );
  const longitudeDelta = Math.min(180, latitudeDelta / longitudeScale);
  const rawSpan = bounds.east - bounds.west;

  if (rawSpan + longitudeDelta * 2 >= 360) {
    return {
      west: -180,
      south: clamp(bounds.south - latitudeDelta, -90, 90),
      east: 180,
      north: clamp(bounds.north + latitudeDelta, -90, 90),
    };
  }

  return {
    west: normalizeLongitude(bounds.west - longitudeDelta),
    south: clamp(bounds.south - latitudeDelta, -90, 90),
    east: normalizeLongitude(bounds.east + longitudeDelta),
    north: clamp(bounds.north + latitudeDelta, -90, 90),
  };
}

function longitudeToTileX(longitude: number, zoom: number) {
  const size = 2 ** zoom;
  return clamp(
    Math.floor(((clamp(longitude, -180, 180 - Number.EPSILON) + 180) / 360) * size),
    0,
    size - 1,
  );
}

function latitudeToTileY(latitude: number, zoom: number) {
  const size = 2 ** zoom;
  const radians =
    (clamp(latitude, -MAX_MERCATOR_LATITUDE, MAX_MERCATOR_LATITUDE) *
      Math.PI) /
    180;
  return clamp(
    Math.floor(
      ((1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2) * size,
    ),
    0,
    size - 1,
  );
}

export function tileKey(tile: MapTile) {
  return `${tile.z}/${tile.x}/${tile.y}`;
}

export function parseTileKey(value: string): MapTile | undefined {
  const match = /^(\d+)\/(\d+)\/(\d+)$/.exec(value);
  if (!match) return undefined;
  const tile = {
    z: Number(match[1]),
    x: Number(match[2]),
    y: Number(match[3]),
  };
  const size = 2 ** tile.z;
  if (
    tile.z !== PARK_TILE_ZOOM ||
    tile.x < 0 ||
    tile.x >= size ||
    tile.y < 0 ||
    tile.y >= size
  ) {
    return undefined;
  }
  return tile;
}

export function tileBounds(tile: MapTile): GeoBounds {
  const size = 2 ** tile.z;
  const west = (tile.x / size) * 360 - 180;
  const east = ((tile.x + 1) / size) * 360 - 180;
  const north =
    (Math.atan(Math.sinh(Math.PI * (1 - (2 * tile.y) / size))) * 180) /
    Math.PI;
  const south =
    (Math.atan(Math.sinh(Math.PI * (1 - (2 * (tile.y + 1)) / size))) *
      180) /
    Math.PI;
  return { west, south, east, north };
}

export function tilesForBounds(
  bounds: GeoBounds,
  zoom = PARK_TILE_ZOOM,
): MapTile[] {
  const south = clamp(bounds.south, -MAX_MERCATOR_LATITUDE, MAX_MERCATOR_LATITUDE);
  const north = clamp(bounds.north, -MAX_MERCATOR_LATITUDE, MAX_MERCATOR_LATITUDE);
  const ranges =
    bounds.west <= bounds.east
      ? [[bounds.west, bounds.east] as const]
      : ([
          [bounds.west, 180],
          [-180, bounds.east],
        ] as const);
  const northY = latitudeToTileY(north, zoom);
  const southY = latitudeToTileY(south, zoom);
  const tiles: MapTile[] = [];

  for (const [west, east] of ranges) {
    const westX = longitudeToTileX(west, zoom);
    const eastX = longitudeToTileX(
      east === 180 ? 180 - Number.EPSILON : east,
      zoom,
    );
    for (let x = westX; x <= eastX; x += 1) {
      for (let y = northY; y <= southY; y += 1) {
        tiles.push({ z: zoom, x, y });
      }
    }
  }

  return Array.from(new Map(tiles.map((tile) => [tileKey(tile), tile])).values());
}

export function parkQueryCoverage(viewport: MapViewport) {
  return nearbyAreaQueryCoverage(viewport);
}

export function waterQueryCoverage(viewport: MapViewport) {
  return nearbyAreaQueryCoverage(viewport);
}

function nearbyAreaQueryCoverage(viewport: MapViewport) {
  const bounds = expandBoundsByMeters(viewport.bounds, 5_000);
  const tiles = tilesForBounds(bounds);
  return { bounds, tiles, key: tiles.map(tileKey).sort().join(",") };
}

export function boundsIntersect(first: GeoBounds, second: GeoBounds) {
  if (first.north < second.south || first.south > second.north) return false;
  const split = (bounds: GeoBounds): GeoBounds[] =>
    bounds.west <= bounds.east
      ? [bounds]
      : [
          { ...bounds, east: 180 },
          { ...bounds, west: -180 },
        ];
  return split(first).some((a) =>
    split(second).some((b) => a.west <= b.east && a.east >= b.west),
  );
}
