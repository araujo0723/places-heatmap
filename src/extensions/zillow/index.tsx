import { useMemo, useState } from "react";
import type { ActionControlProps } from "../api";
import { defineExtension } from "../api";
import { regionPolygons } from "./geometry";
import { buildZillowRentalUrl, getBoundsForPolygons } from "./zillow";

function ZillowControls({ disabled, regions }: ActionControlProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const polygons = useMemo(() => regionPolygons(regions), [regions]);
  const bounds = useMemo(() => getBoundsForPolygons(polygons), [polygons]);

  const openZillow = async () => {
    if (!bounds || loading) return;
    setLoading(true);
    setError(undefined);

    try {
      const response = await fetch("/api/zillow/custom-region", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ polygons }),
      });
      const payload = (await response.json()) as {
        customRegionId?: string;
        message?: string;
      };
      if (!response.ok || !payload.customRegionId) {
        throw new Error(
          payload.message ?? "Could not create the Zillow region.",
        );
      }

      window.open(
        buildZillowRentalUrl(bounds, payload.customRegionId),
        "_blank",
        "noopener,noreferrer",
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not create the Zillow region.",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <button
        className="w-full rounded-lg bg-[#006aff] px-3 py-2 text-xs font-bold tracking-wide text-white shadow-sm hover:bg-[#0055cc] focus:ring-2 focus:ring-blue-300 focus:outline-none disabled:cursor-not-allowed disabled:opacity-40"
        type="button"
        disabled={disabled || loading || !bounds}
        onClick={() => void openZillow()}
      >
        {loading ? "CREATING ZILLOW REGION…" : "GO TO ZILLOW"}
      </button>
      {!bounds ? (
        <p className="mt-2 text-[11px] leading-4 text-slate-500">
          Draw or activate a region boundary first.
        </p>
      ) : null}
      {error ? (
        <p className="mt-2 text-[11px] leading-4 text-rose-600" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export default defineExtension({
  apiVersion: 1,
  id: "zillow",
  name: "Zillow",
  description: "Open the current intersecting region in Zillow rentals.",
  actions: [
    {
      id: "go-to-zillow",
      name: "Go to Zillow",
      Controls: ZillowControls,
    },
  ],
});
