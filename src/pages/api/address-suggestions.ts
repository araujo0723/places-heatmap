import type { APIRoute } from "astro";
import { lookupAddressSuggestions } from "../../server/commute";

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (query.length < 3) {
    return Response.json({ suggestions: [] });
  }

  try {
    const suggestions = await lookupAddressSuggestions(query);
    return Response.json(
      { suggestions },
      {
        headers: {
          "Cache-Control": "public, max-age=300, stale-while-revalidate=86400",
        },
      },
    );
  } catch (error) {
    return Response.json(
      {
        suggestions: [],
        message:
          error instanceof Error ? error.message : "Address lookup failed.",
      },
      { status: 502 },
    );
  }
};
