import { defineExtension } from "../api";
import {
  CommuteFilterControls,
  CommuteHeatmapControls,
  type CommuteFilterState,
  type CommuteHeatmapState,
} from "./controls";
import { loadDrivingIsochrones } from "./data";
import { commuteHeatSurface } from "./geometry";

const EMPTY_REGIONS = {
  collection: {
    type: "FeatureCollection" as const,
    features: [],
  },
  itemCount: 0,
};

export default defineExtension({
  apiVersion: 1,
  id: "commute",
  name: "Commute",
  icon: "/icons/car.svg",
  description:
    "Driving-time regions around a validated destination address.",
  filters: [
    {
      id: "time",
      name: "Commute",
      initialState: { minutes: 30 } satisfies CommuteFilterState,
      Controls: CommuteFilterControls,
      regionStyle: {
        fillColor: "#dc2626",
        fillOpacity: 0.05,
        lineColor: "#dc2626",
        lineWidth: 2.5,
        lineOpacity: 0.9,
      },
      resolveRegions: async (
        { address, minutes }: CommuteFilterState,
        context,
      ) => {
        if (!address) return EMPTY_REGIONS;
        const collection = await loadDrivingIsochrones(
          address,
          [minutes],
          context.signal,
        );
        return { collection, itemCount: collection.features.length };
      },
    },
  ],
  heatmaps: [
    {
      kind: "surface",
      id: "travel-time",
      name: "Commute",
      initialState: {} satisfies CommuteHeatmapState,
      Controls: CommuteHeatmapControls,
      load: async ({ address }: CommuteHeatmapState, context) => {
        if (!address) {
          return {
            collection: {
              type: "FeatureCollection" as const,
              features: [],
            },
            itemCount: 0,
          };
        }
        const collection = await loadDrivingIsochrones(
          address,
          [15, 20, 25, 35, 40, 45],
          context.signal,
        );
        return {
          collection: commuteHeatSurface(collection),
          itemCount: 2,
        };
      },
      style: {
        opacity: 0.82,
        colorRamp: [
          [0, "rgba(250, 204, 21, 0)"],
          [0.15, "rgba(250, 204, 21, 0.18)"],
          [0.32, "rgba(250, 204, 21, 0.72)"],
          [0.5, "#facc15"],
          [0.68, "#d9d92a"],
          [0.85, "#84cc16"],
          [1, "#16a34a"],
        ],
      },
    },
  ],
});
