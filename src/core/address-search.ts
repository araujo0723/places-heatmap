export interface AddressSelection {
  label: string;
  address: string;
  center: [number, number];
}

function validCoordinate(value: unknown): value is [number, number] {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    value.every(
      (coordinate) =>
        typeof coordinate === "number" && Number.isFinite(coordinate),
    )
  );
}

function isAddressSelection(value: unknown): value is AddressSelection {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<AddressSelection>;
  return (
    typeof candidate.label === "string" &&
    typeof candidate.address === "string" &&
    validCoordinate(candidate.center)
  );
}

export async function searchAddresses(
  query: string,
  signal: AbortSignal,
  proximity: [number, number],
): Promise<AddressSelection[]> {
  const parameters = new URLSearchParams({
    q: query,
    longitude: String(proximity[0]),
    latitude: String(proximity[1]),
  });
  const response = await fetch(
    `/api/address-suggestions?${parameters}`,
    { signal },
  );
  const payload = (await response.json().catch(() => ({}))) as {
    suggestions?: unknown;
    message?: unknown;
  };
  if (!response.ok) {
    throw new Error(
      typeof payload.message === "string"
        ? payload.message
        : "Address lookup failed.",
    );
  }
  if (
    !Array.isArray(payload.suggestions) ||
    !payload.suggestions.every(isAddressSelection)
  ) {
    throw new Error("Address lookup returned malformed data.");
  }
  return payload.suggestions;
}
