import type { FeatureCollection } from "geojson";
import type {
  RegionFeature,
  RegionGeometry,
  SurfaceProperties,
} from "../extensions/api";

export interface SurfaceClipRequest {
  instanceId: string;
  collection: FeatureCollection<RegionGeometry, SurfaceProperties>;
}

export type GeometryWorkerRequest =
  | {
      kind: "intersect-regions";
      groups: RegionFeature[][];
    }
  | {
      kind: "clip-surfaces";
      surfaces: SurfaceClipRequest[];
      regions: RegionFeature[];
    };

export type GeometryWorkerResult =
  | {
      kind: "intersect-regions";
      boundary: RegionFeature | undefined;
    }
  | {
      kind: "clip-surfaces";
      surfaces: SurfaceClipRequest[];
    };

export type GeometryWorkerResponse =
  | {
      ok: true;
      result: GeometryWorkerResult;
    }
  | {
      ok: false;
      error: string;
    };
