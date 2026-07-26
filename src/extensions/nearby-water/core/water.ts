import type { GeoBounds } from "../../../core/geo";

export interface WaterRecord {
  id: string;
  name?: string;
  center: [number, number];
  bbox?: GeoBounds;
}
