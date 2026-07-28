import { useEffect, useRef, useState } from "react";
import type { ControlProps } from "../api";
import { defineExtension } from "../api";
import {
  filterIncomeRegions,
  incomeHeatSurface,
  MAX_INCOME,
} from "./core/income";
import { loadMedianHouseholdIncome } from "./data";

export interface IncomeFilterState {
  minimumIncome: number;
}

function formatIncome(income: number) {
  return income === 0 ? "$0" : `$${income / 1_000}k`;
}

export function MinimumIncomeControls({
  value,
  onChange,
  disabled,
  loading,
}: ControlProps<IncomeFilterState>) {
  const [minimumIncome, setMinimumIncome] = useState(value.minimumIncome);
  const committedIncome = useRef(value.minimumIncome);

  useEffect(() => {
    committedIncome.current = value.minimumIncome;
    setMinimumIncome(value.minimumIncome);
  }, [value.minimumIncome]);

  const commitIncome = (nextIncome: number) => {
    if (nextIncome === committedIncome.current) return;
    committedIncome.current = nextIncome;
    onChange({ minimumIncome: nextIncome });
  };

  return (
    <label className="block text-xs text-slate-600">
      <span className="mb-2 flex items-center justify-between font-medium">
        Minimum income
        <output className="rounded-md bg-amber-50 px-2 py-0.5 font-semibold text-amber-900">
          {formatIncome(minimumIncome)}
        </output>
      </span>
      <input
        aria-label="Minimum household income"
        className="h-2 w-full cursor-pointer accent-amber-500 disabled:cursor-not-allowed disabled:opacity-50"
        type="range"
        min="0"
        max={MAX_INCOME}
        step="25000"
        value={minimumIncome}
        disabled={disabled || loading}
        onChange={(event) =>
          setMinimumIncome(Number(event.currentTarget.value))
        }
        onBlur={(event) =>
          commitIncome(Number(event.currentTarget.value))
        }
        onKeyUp={(event) =>
          commitIncome(Number(event.currentTarget.value))
        }
        onPointerCancel={(event) =>
          commitIncome(Number(event.currentTarget.value))
        }
        onPointerUp={(event) =>
          commitIncome(Number(event.currentTarget.value))
        }
      />
    </label>
  );
}

export default defineExtension({
  apiVersion: 1,
  id: "median-household-income",
  name: "Median household income",
  icon: "/icons/house.svg",
  description:
    "2020–2024 ACS median household income by Georgia census block group.",
  filters: [
    {
      id: "minimum-income",
      name: "Median household income",
      initialState: {
        minimumIncome: 0,
      } satisfies IncomeFilterState,
      Controls: MinimumIncomeControls,
      regionStyle: {
        fillColor: "#d4af37",
        fillOpacity: 0.12,
        lineColor: "#b68d13",
        lineWidth: 1.5,
        lineOpacity: 0.9,
      },
      resolveRegions: async ({ minimumIncome }, context) => {
        const collection = await loadMedianHouseholdIncome(
          context.viewport,
          context.signal,
        );
        return filterIncomeRegions(collection, minimumIncome);
      },
    },
  ],
  heatmaps: [
    {
      kind: "surface",
      id: "income",
      name: "Median household income",
      initialState: {},
      load: async (_state, context) => {
        const collection = await loadMedianHouseholdIncome(
          context.viewport,
          context.signal,
        );
        return {
          collection: incomeHeatSurface(collection),
          itemCount: collection.features.length,
        };
      },
      style: {
        opacity: 0.82,
        colorRamp: [
          [0, "rgba(212, 175, 55, 0.12)"],
          [0.5, "rgba(212, 175, 55, 0.58)"],
          [1, "#d4af37"],
        ],
      },
    },
  ],
});
