import { useEffect, useRef, useState } from "react";
import type { ControlProps } from "../api";
import { defineExtension } from "../api";
import { loadNearbyWater } from "./data";
import { waterFilterRegions, waterHeatContours } from "./geometry";

interface WaterFilterState {
  distance: number;
}

function DistanceControls({
  value,
  onChange,
  disabled,
  loading,
}: ControlProps<WaterFilterState>) {
  const [distance, setDistance] = useState(value.distance);
  const committedDistance = useRef(value.distance);

  useEffect(() => {
    committedDistance.current = value.distance;
    setDistance(value.distance);
  }, [value.distance]);

  const commitDistance = (nextDistance: number) => {
    if (nextDistance === committedDistance.current) return;
    committedDistance.current = nextDistance;
    onChange({ distance: nextDistance });
  };

  return (
    <label className="block text-xs text-slate-600">
      <span className="mb-2 flex items-center justify-between font-medium">
        Distance
        <output className="rounded-md bg-slate-100 px-2 py-0.5 font-semibold text-slate-800">
          {distance} m
        </output>
      </span>
      <input
        aria-label="Water distance"
        className="h-2 w-full cursor-pointer accent-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
        type="range"
        min="0"
        max="2000"
        step="50"
        value={distance}
        disabled={disabled || loading}
        onChange={(event) => setDistance(Number(event.currentTarget.value))}
        onBlur={(event) =>
          commitDistance(Number(event.currentTarget.value))
        }
        onKeyUp={(event) =>
          commitDistance(Number(event.currentTarget.value))
        }
        onPointerCancel={(event) =>
          commitDistance(Number(event.currentTarget.value))
        }
        onPointerUp={(event) =>
          commitDistance(Number(event.currentTarget.value))
        }
      />
    </label>
  );
}

export default defineExtension({
  apiVersion: 1,
  id: "nearby-water",
  name: "Lakes",
  icon: "/icons/water.svg",
  description:
    "OpenStreetMap lakes, ponds, reservoirs, and similar enclosed bodies of water in the current view and the surrounding 5 km.",
  filters: [
    {
      id: "distance",
      name: "Lakes",
      initialState: { distance: 300 },
      Controls: DistanceControls,
      regionStyle: {
        fillColor: "#2563eb",
        lineColor: "#1d4ed8",
      },
      resolveRegions: async ({ distance }, context) => {
        const waters = await loadNearbyWater(context.viewport, context.signal);
        const { regions, itemCount } = waterFilterRegions(waters, distance);
        return {
          collection: {
            type: "FeatureCollection",
            features: regions,
          },
          itemCount,
        };
      },
    },
  ],
  heatmaps: [
    {
      kind: "surface",
      id: "influence",
      name: "Lakes",
      initialState: {},
      load: async (_state, context) => {
        const waters = await loadNearbyWater(context.viewport, context.signal);
        return {
          collection: waterHeatContours(waters),
          itemCount: waters.length,
        };
      },
      style: {
        opacity: 0.82,
        colorRamp: [
          [0, "rgba(37, 99, 235, 0)"],
          [1, "rgba(37, 99, 235, 1)"],
        ],
      },
    },
  ],
});
