import type {
  GeometryWorkerRequest,
  GeometryWorkerResponse,
  GeometryWorkerResult,
  SurfaceClipRequest,
} from "./geometry-worker-protocol";
import {
  clipSurfaceCollection,
  intersectRegionGroups,
} from "./regions";
import type { RegionFeature } from "../extensions/api";

function abortError() {
  return new DOMException("Map geometry recalculation was canceled.", "AbortError");
}

function calculateSynchronously(
  request: GeometryWorkerRequest,
): GeometryWorkerResult {
  if (request.kind === "intersect-regions") {
    return {
      kind: request.kind,
      boundary: intersectRegionGroups(request.groups),
    };
  }
  return {
    kind: request.kind,
    surfaces: request.surfaces.map(({ instanceId, collection }) => ({
      instanceId,
      collection: clipSurfaceCollection(collection, request.regions),
    })),
  };
}

async function runGeometryWorker(
  request: GeometryWorkerRequest,
  signal: AbortSignal,
): Promise<GeometryWorkerResult> {
  if (signal.aborted) throw abortError();

  if (typeof Worker === "undefined") {
    await Promise.resolve();
    signal.throwIfAborted();
    return calculateSynchronously(request);
  }

  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL("./geometry-worker.ts", import.meta.url),
      { type: "module" },
    );
    const finish = () => {
      signal.removeEventListener("abort", onAbort);
      worker.terminate();
    };
    const onAbort = () => {
      finish();
      reject(abortError());
    };

    signal.addEventListener("abort", onAbort, { once: true });
    worker.onmessage = ({ data }: MessageEvent<GeometryWorkerResponse>) => {
      finish();
      if (data.ok) {
        resolve(data.result);
      } else {
        reject(new Error(data.error));
      }
    };
    worker.onerror = (event) => {
      finish();
      reject(
        new Error(event.message || "Map geometry worker failed to load."),
      );
    };
    worker.postMessage(request);
  });
}

export async function calculateRegionIntersection(
  groups: RegionFeature[][],
  signal: AbortSignal,
) {
  const result = await runGeometryWorker(
    { kind: "intersect-regions", groups },
    signal,
  );
  if (result.kind !== "intersect-regions") {
    throw new Error("Map geometry worker returned an invalid result.");
  }
  return result.boundary;
}

export async function calculateClippedSurfaces(
  surfaces: SurfaceClipRequest[],
  regions: RegionFeature[],
  signal: AbortSignal,
) {
  const result = await runGeometryWorker(
    { kind: "clip-surfaces", surfaces, regions },
    signal,
  );
  if (result.kind !== "clip-surfaces") {
    throw new Error("Map geometry worker returned an invalid result.");
  }
  return result.surfaces;
}
