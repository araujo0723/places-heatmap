import type { APIRoute } from "astro";
import {
  SavedMapValidationError,
  parseSavedMapState,
} from "../../../core/saved-map";
import { getSavedMapStore } from "../../../server/saved-maps";

export const prerender = false;

const MAX_STATE_BYTES = 1_000_000;

async function readState(request: Request) {
  const text = await request.text();
  if (text.length > MAX_STATE_BYTES) {
    throw new SavedMapValidationError("Saved map state is too large.");
  }
  return parseSavedMapState(JSON.parse(text));
}

export const POST: APIRoute = async ({ request }) => {
  try {
    const savedMap = getSavedMapStore().create(await readState(request));
    return Response.json(savedMap, {
      status: 201,
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
    console.error("Could not create saved map.", error);
    return Response.json(
      { message: "Could not save the map." },
      { status: 500 },
    );
  }
};
