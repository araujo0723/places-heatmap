import type { APIRoute } from "astro";
import { parseRequestBounds } from "../../../../server/request-bounds";
import { getWaterForBounds } from "../../server/water";

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  const bounds = parseRequestBounds(new URL(request.url));
  if (!bounds) {
    return Response.json(
      {
        error:
          "Valid west, south, east, and north coordinates are required.",
      },
      { status: 400 },
    );
  }

  try {
    return Response.json(
      {
        bounds,
        waters: await getWaterForBounds(bounds),
      },
      {
        headers: {
          "Cache-Control": "public, max-age=300, stale-while-revalidate=3600",
        },
      },
    );
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Nearby water could not be loaded.",
      },
      { status: 500 },
    );
  }
};
