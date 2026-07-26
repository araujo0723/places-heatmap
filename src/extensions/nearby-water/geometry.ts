import type { FeatureCollection } from "geojson";
import {
  proximityFilterRegions,
  proximityHeatContours,
} from "../../core/proximity";
import type {
  RegionGeometry,
  SurfaceProperties,
} from "../api";
import type { WaterRecord } from "./core/water";

export function waterFilterRegions(
  waters: WaterRecord[],
  distance: number,
) {
  return proximityFilterRegions(waters, distance, "waterId");
}

export function waterHeatContours(
  waters: WaterRecord[],
): FeatureCollection<RegionGeometry, SurfaceProperties> {
  return proximityHeatContours(waters, "water");
}
