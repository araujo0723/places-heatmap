import type { APIRoute } from "astro";
import { lookupAddressSuggestions } from "../../server/address-search";

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  const parameters = new URL(request.url).searchParams;
  const query = parameters.get("q")?.trim() ?? "";
  const longitudeValue = parameters.get("longitude");
  const latitudeValue = parameters.get("latitude");
  const longitude = Number(longitudeValue);
  const latitude = Number(latitudeValue);
  const proximity: [number, number] | undefined =
    longitudeValue !== null &&
    latitudeValue !== null &&
    Number.isFinite(longitude) &&
    longitude >= -180 &&
    longitude <= 180 &&
    Number.isFinite(latitude) &&
    latitude >= -90 &&
    latitude <= 90
      ? [longitude, latitude]
      : undefined;
  if (query.length < 3) {
    return Response.json({ suggestions: [] });
  }

  try {
    const suggestions = await lookupAddressSuggestions(query, { proximity });
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
