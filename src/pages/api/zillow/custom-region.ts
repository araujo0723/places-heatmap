import type { APIRoute } from "astro";
import type {
  ZillowCoordinate,
  ZillowPolygon,
} from "../../../extensions/zillow/geometry";
import { preparePolygonsForZillow } from "../../../extensions/zillow/geometry";
import { buildZillowRegionSaveRequest } from "../../../extensions/zillow/zillow";

interface ZillowResponse {
  data?: {
    saveCustomRegion?: {
      customRegionId?: string;
      polygon?: string;
    };
  };
  errors?: Array<{ message?: string }>;
}

export const prerender = false;

function isCoordinate(value: unknown): value is ZillowCoordinate {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    typeof value[0] === "number" &&
    Number.isFinite(value[0]) &&
    typeof value[1] === "number" &&
    Number.isFinite(value[1])
  );
}

function isPolygon(value: unknown): value is ZillowPolygon {
  return Array.isArray(value) && value.length >= 4 && value.every(isCoordinate);
}

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = (await request.json()) as { polygons?: unknown };
    const input = Array.isArray(body.polygons)
      ? body.polygons.filter(isPolygon)
      : [];
    const polygons = preparePolygonsForZillow(input);
    if (polygons.length === 0) {
      return Response.json(
        { message: "A valid region boundary is required." },
        { status: 400 },
      );
    }

    const zillowRequest = buildZillowRegionSaveRequest(polygons);
    const response = await fetch(
      "https://www.zillow.com/zg-graph?operationName=SaveCustomRegion",
      {
        method: "POST",
        headers: {
          accept: "*/*",
          "content-type": "application/json",
          referer: "https://www.zillow.com/homes/for_rent/",
          "x-caller-id": "search-page-map",
        },
        body: JSON.stringify(zillowRequest),
      },
    );
    const rawBody = await response.text();
    let payload: ZillowResponse;
    try {
      payload = JSON.parse(rawBody) as ZillowResponse;
    } catch {
      throw new Error(
        response.status === 403
          ? "Zillow blocked the region request. Try again shortly."
          : "Zillow returned an unexpected response.",
      );
    }

    const saved = payload.data?.saveCustomRegion;
    if (!response.ok || !saved?.customRegionId) {
      throw new Error(
        payload.errors?.map(({ message }) => message).find(Boolean) ??
          "Could not create the Zillow region.",
      );
    }

    return Response.json({
      customRegionId: saved.customRegionId,
      polygon: saved.polygon ?? null,
    });
  } catch (cause) {
    return Response.json(
      {
        message:
          cause instanceof Error
            ? cause.message
            : "Could not create the Zillow region.",
      },
      { status: 502 },
    );
  }
};
