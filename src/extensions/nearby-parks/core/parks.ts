import type { GeoBounds } from "../../../core/geo";

export interface ParkRecord {
  id: string;
  name?: string;
  center: [number, number];
  bbox?: GeoBounds;
}
