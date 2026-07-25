import type { GeoBounds } from "./geo";

export interface WaterRecord {
  id: string;
  name?: string;
  center: [number, number];
  bbox?: GeoBounds;
}
