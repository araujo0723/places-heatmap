import type { ControlProps } from "../api";
import { defineExtension } from "../api";
import { randomPlaces } from "./data";

interface WeightFilterState {
  coverage: number;
  variation: number;
}

interface RandomHeatmapState {
  pointCount: number;
  variation: number;
}

function MinimumWeightControls({
  value,
  onChange,
  disabled,
  loading,
}: ControlProps<WeightFilterState>) {
  return (
    <div className="space-y-3 text-xs text-slate-600">
      <label className="block">
        <span className="mb-2 flex items-center justify-between font-medium">
          Random coverage
          <output className="rounded-md bg-slate-100 px-2 py-0.5 font-semibold text-slate-800">
            {value.coverage}%
          </output>
        </span>
        <input
          aria-label="Random coverage"
          className="h-2 w-full cursor-pointer accent-indigo-600 disabled:cursor-not-allowed disabled:opacity-50"
          type="range"
          min="10"
          max="100"
          step="5"
          value={value.coverage}
          disabled={disabled || loading}
          onChange={(event) =>
            onChange({
              ...value,
              coverage: Number(event.currentTarget.value),
            })
          }
        />
      </label>
      <button
        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        type="button"
        disabled={disabled || loading}
        onClick={() => onChange({ ...value, variation: value.variation + 1 })}
      >
        Shuffle filter
      </button>
    </div>
  );
}

function RandomHeatmapControls({
  value,
  onChange,
  disabled,
  loading,
}: ControlProps<RandomHeatmapState>) {
  return (
    <div className="space-y-3 text-xs text-slate-600">
      <label className="block">
        <span className="mb-2 flex items-center justify-between font-medium">
          Random points
          <output className="rounded-md bg-slate-100 px-2 py-0.5 font-semibold text-slate-800">
            {value.pointCount}
          </output>
        </span>
        <input
          aria-label="Random points"
          className="h-2 w-full cursor-pointer accent-indigo-600 disabled:cursor-not-allowed disabled:opacity-50"
          type="range"
          min="40"
          max="240"
          step="20"
          value={value.pointCount}
          disabled={disabled || loading}
          onChange={(event) =>
            onChange({
              ...value,
              pointCount: Number(event.currentTarget.value),
            })
          }
        />
      </label>
      <button
        className="w-full rounded-lg bg-indigo-600 px-3 py-2 font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
        type="button"
        disabled={disabled || loading}
        onClick={() => onChange({ ...value, variation: value.variation + 1 })}
      >
        Regenerate heatmap
      </button>
    </div>
  );
}

function randomScore(longitude: number, latitude: number, seed: number) {
  const value = Math.sin(
    longitude * 12_989.8 + latitude * 78_233.1 + seed * 0.0001,
  ) * 43_758.5453;
  return value - Math.floor(value);
}

export default defineExtension({
  apiVersion: 1,
  id: "demo-places",
  name: "Random explorer",
  description: "Randomized regions and weighted points in the current map view.",
  filters: [
    {
      id: "minimum-weight",
      name: "Random area filter",
      initialState: { coverage: 70, variation: 0 },
      Controls: MinimumWeightControls,
      resolvePredicate: ({ coverage, variation }, { randomSeed }) => (point) => {
        const [longitude, latitude] = point.feature.geometry.coordinates;
        return (
          point.origin.extensionId !== "demo-places" ||
          randomScore(longitude, latitude, randomSeed + variation) <
            coverage / 100
        );
      },
    },
  ],
  heatmaps: [
    {
      id: "density",
      name: "Random heatmap",
      initialState: { pointCount: 140, variation: 0 },
      Controls: RandomHeatmapControls,
      load: async ({ pointCount, variation }, { signal, viewport, randomSeed }) => {
        signal.throwIfAborted();
        return randomPlaces(viewport, randomSeed + variation, pointCount);
      },
      style: {
        weightProperty: "weight",
        radius: 34,
        intensity: 1.15,
        opacity: 0.82,
        colorRamp: [
          [0, "rgba(49, 46, 129, 0)"],
          [0.2, "#4338ca"],
          [0.45, "#0891b2"],
          [0.7, "#facc15"],
          [1, "#f97316"],
        ],
      },
    },
  ],
});
