import type {
  GeometryWorkerRequest,
  GeometryWorkerResponse,
} from "./geometry-worker-protocol";
import {
  clipSurfaceCollection,
  intersectRegionGroups,
} from "./regions";

const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<GeometryWorkerRequest>) => void) | null;
  postMessage(message: GeometryWorkerResponse): void;
};

workerScope.onmessage = ({ data }) => {
  try {
    if (data.kind === "intersect-regions") {
      workerScope.postMessage({
        ok: true,
        result: {
          kind: data.kind,
          boundary: intersectRegionGroups(data.groups),
        },
      });
      return;
    }

    workerScope.postMessage({
      ok: true,
      result: {
        kind: data.kind,
        surfaces: data.surfaces.map(({ instanceId, collection }) => ({
          instanceId,
          collection: clipSurfaceCollection(collection, data.regions),
        })),
      },
    });
  } catch (error) {
    workerScope.postMessage({
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Map geometry could not be recalculated.",
    });
  }
};
