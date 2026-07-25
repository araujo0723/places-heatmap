import type { GeoBounds } from "./geo";

export interface ParkRecord {
  id: string;
  name?: string;
  center: [number, number];
  bbox?: GeoBounds;
}

