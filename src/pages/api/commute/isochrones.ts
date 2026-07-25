import type { APIRoute } from "astro";
import { getDrivingIsochrones } from "../../../server/commute";

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "A JSON request body is required." }, { status: 400 });
  }
  const candidate =
    payload && typeof payload === "object"
      ? (payload as { center?: unknown; minutes?: unknown })
      : {};
  const center = candidate.center;
  const minutes = candidate.minutes;
  if (
    !Array.isArray(center) ||
    center.length < 2 ||
    !center.every((value) => typeof value === "number") ||
    !Array.isArray(minutes) ||
    !minutes.every((value) => typeof value === "number")
  ) {
    return Response.json(
      { error: "Provide an address center and commute times." },
      { status: 400 },
    );
  }

  try {
    const collection = await getDrivingIsochrones(
      [center[0], center[1]],
      minutes,
    );
    return Response.json(collection);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Commute-time regions could not be loaded.";
    const status = message.startsWith("Set ORS_API_KEY") ? 503 : 502;
    return Response.json({ error: message }, { status });
  }
};
