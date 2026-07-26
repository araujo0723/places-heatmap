import type { GeoBounds } from "../core/geo";

const PARAMETERS = ["west", "south", "east", "north"] as const;

export function parseRequestBounds(url: URL): GeoBounds | undefined {
  const values = Object.fromEntries(
    PARAMETERS.map((parameter) => [
      parameter,
      Number(url.searchParams.get(parameter)),
    ]),
  ) as unknown as GeoBounds;
  if (
    PARAMETERS.some(
      (parameter) =>
        !url.searchParams.has(parameter) ||
        !Number.isFinite(values[parameter]),
    ) ||
    values.west < -180 ||
    values.west > 180 ||
    values.east < -180 ||
    values.east > 180 ||
    values.south < -90 ||
    values.south > 90 ||
    values.north < -90 ||
    values.north > 90 ||
    values.south > values.north
  ) {
    return undefined;
  }
  return values;
}
