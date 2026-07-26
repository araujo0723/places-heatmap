import type { APIRoute } from "astro";
import {
  SavedMapValidationError,
  parseSavedMapState,
} from "../../../core/saved-map";
import {
  getSavedMapStore,
  isSavedMapId,
} from "../../../server/saved-maps";

export const prerender = false;

const MAX_STATE_BYTES = 1_000_000;

function requestedId(parameters: Record<string, string | undefined>) {
  const id = parameters.id ?? "";
  return isSavedMapId(id) ? id : undefined;
}

async function readState(request: Request) {
  const text = await request.text();
  if (text.length > MAX_STATE_BYTES) {
    throw new SavedMapValidationError("Saved map state is too large.");
  }
  return parseSavedMapState(JSON.parse(text));
}

export const GET: APIRoute = ({ params }) => {
  const id = requestedId(params);
  const savedMap = id ? getSavedMapStore().get(id) : undefined;
  if (!savedMap) {
    return Response.json({ message: "Saved map not found." }, { status: 404 });
  }
  return Response.json(savedMap, {
    headers: { "Cache-Control": "no-store" },
  });
};

export const PUT: APIRoute = async ({ params, request }) => {
  const id = requestedId(params);
  if (!id) {
    return Response.json({ message: "Saved map not found." }, { status: 404 });
  }
  try {
    const savedMap = getSavedMapStore().update(id, await readState(request));
    if (!savedMap) {
      return Response.json(
        { message: "Saved map not found." },
        { status: 404 },
      );
    }
    return Response.json(savedMap, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (
      error instanceof SavedMapValidationError ||
      error instanceof SyntaxError
    ) {
      return Response.json(
        {
          message:
            error instanceof Error ? error.message : "Invalid saved map state.",
        },
        { status: 400 },
      );
    }
    console.error("Could not update saved map.", error);
    return Response.json(
      { message: "Could not save the map." },
      { status: 500 },
    );
  }
};
