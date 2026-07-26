import type { FeatureCollection } from "geojson";
import {
  proximityFilterRegions,
  proximityHeatContours,
} from "../../core/proximity";
import type {
  RegionGeometry,
  SurfaceProperties,
} from "../api";
import type { ParkRecord } from "./core/parks";

export function parkFilterRegions(
  parks: ParkRecord[],
  distance: number,
) {
  return proximityFilterRegions(parks, distance, "parkId");
}

export function parkHeatContours(
  parks: ParkRecord[],
): FeatureCollection<RegionGeometry, SurfaceProperties> {
  return proximityHeatContours(parks, "park");
}
