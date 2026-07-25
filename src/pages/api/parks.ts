import type { APIRoute } from "astro";
import { MAX_PARK_TILES, parseTileKey, tileKey } from "../../core/geo";
import { getParksForTiles } from "../../server/parks";

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  const url = new URL(request.url);
  const requestedKeys = Array.from(
    new Set(
      (url.searchParams.get("tiles") ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  );
  if (requestedKeys.length === 0) {
    return Response.json(
      { error: "At least one park tile is required." },
      { status: 400 },
    );
  }
  if (requestedKeys.length > MAX_PARK_TILES) {
    return Response.json(
      {
        code: "VIEWPORT_TOO_WIDE",
        error: "Zoom in to search for nearby parks.",
      },
      { status: 422 },
    );
  }
  const tiles = requestedKeys.map(parseTileKey);
  if (tiles.some((tile) => !tile)) {
    return Response.json(
      { error: "Park tile identifiers must use zoom 11." },
      { status: 400 },
    );
  }

  try {
    const validTiles = tiles.filter(
      (tile): tile is NonNullable<typeof tile> => !!tile,
    );
    const parks = await getParksForTiles(validTiles);
    return Response.json(
      {
        tiles: validTiles.map(tileKey),
        parks,
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
            : "Nearby parks could not be loaded.",
      },
      { status: 502 },
    );
  }
};

