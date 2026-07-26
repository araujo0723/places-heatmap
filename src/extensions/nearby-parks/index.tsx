import { useEffect, useRef, useState } from "react";
import type { ControlProps } from "../api";
import { defineExtension } from "../api";
import { loadNearbyParks } from "./data";
import { parkFilterRegions, parkHeatContours } from "./geometry";

interface ParkFilterState {
  distance: number;
}

function DistanceControls({
  value,
  onChange,
  disabled,
  loading,
}: ControlProps<ParkFilterState>) {
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
        aria-label="Park distance"
        className="h-2 w-full cursor-pointer accent-green-600 disabled:cursor-not-allowed disabled:opacity-50"
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
  id: "nearby-parks",
  name: "Parks",
  icon: "/icons/tree.svg",
  description:
    "OpenStreetMap city parks in the current view and the surrounding 5 km.",
  filters: [
    {
      id: "distance",
      name: "Parks",
      initialState: { distance: 300 },
      Controls: DistanceControls,
      resolveRegions: async ({ distance }, context) => {
        const parks = await loadNearbyParks(context.viewport, context.signal);
        const { regions, itemCount } = parkFilterRegions(parks, distance);
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
      name: "Parks",
      initialState: {},
      load: async (_state, context) => {
        const parks = await loadNearbyParks(context.viewport, context.signal);
        return {
          collection: parkHeatContours(parks),
          itemCount: parks.length,
        };
      },
      style: {
        opacity: 0.82,
        colorRamp: [
          [0, "rgba(22, 163, 74, 0)"],
          [1, "rgba(22, 163, 74, 1)"],
        ],
      },
    },
  ],
});
