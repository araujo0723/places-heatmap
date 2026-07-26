import {
  parseSavedMapState,
  type SavedMapState,
} from "./saved-map";

interface SavedMapResponse {
  id: string;
  state: unknown;
}

async function responseMessage(response: Response) {
  try {
    const body = (await response.json()) as { message?: unknown };
    if (typeof body.message === "string") return body.message;
  } catch {
    // Fall through to the status-based message.
  }
  return `Saved map request failed (${response.status}).`;
}

async function readSavedMapResponse(response: Response) {
  if (!response.ok) throw new Error(await responseMessage(response));
  const body = (await response.json()) as SavedMapResponse;
  if (!body || typeof body.id !== "string") {
    throw new Error("The saved map response was invalid.");
  }
  return {
    id: body.id,
    state: parseSavedMapState(body.state),
  };
}

export async function loadSavedMap(id: string, signal?: AbortSignal) {
  const response = await fetch(`/api/maps/${encodeURIComponent(id)}`, {
    signal,
  });
  return readSavedMapResponse(response);
}

export async function createSavedMap(state: SavedMapState) {
  const response = await fetch("/api/maps", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(state),
  });
  return readSavedMapResponse(response);
}

export async function updateSavedMap(id: string, state: SavedMapState) {
  const response = await fetch(`/api/maps/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(state),
  });
  return readSavedMapResponse(response);
}
