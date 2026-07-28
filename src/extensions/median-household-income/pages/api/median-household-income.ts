import type { APIRoute } from "astro";
import { parseRequestBounds } from "../../../../server/request-bounds";
import { getIncomeForBounds } from "../../server/income";

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
        regions: await getIncomeForBounds(bounds),
      },
      {
        headers: {
          "Cache-Control":
            "public, max-age=3600, stale-while-revalidate=86400",
        },
      },
    );
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Median household income could not be loaded.",
      },
      { status: 500 },
    );
  }
};
