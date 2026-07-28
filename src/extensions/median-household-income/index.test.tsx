import { fireEvent, render, screen } from "@testing-library/react";
import { vi } from "vitest";
import extension, {
  MinimumIncomeControls,
  type IncomeFilterState,
} from "./index";

describe("median household income extension", () => {
  it("defines a gold filter and control-free heatmap", () => {
    expect(extension.filters?.[0]).toMatchObject({
      name: "Median household income",
      initialState: { minimumIncome: 0 },
      regionStyle: {
        fillColor: "#d4af37",
        lineColor: "#b68d13",
      },
    });
    expect(extension.heatmaps?.[0]).toMatchObject({
      kind: "surface",
      name: "Median household income",
      style: {
        colorRamp: [
          [0, "rgba(212, 175, 55, 0.12)"],
          [0.5, "rgba(212, 175, 55, 0.58)"],
          [1, "#d4af37"],
        ],
      },
    });
    expect(extension.heatmaps?.[0].Controls).toBeUndefined();
  });

  it("offers a 0–300k slider in 25k steps and commits changes", () => {
    const onChange = vi.fn<(state: IncomeFilterState) => void>();
    render(
      <MinimumIncomeControls
        value={{ minimumIncome: 0 }}
        onChange={onChange}
        disabled={false}
        loading={false}
        viewport={{
          center: [-84.39, 33.75],
          bounds: {
            west: -84.55,
            south: 33.6,
            east: -84.23,
            north: 33.9,
          },
        }}
      />,
    );

    const slider = screen.getByRole("slider", {
      name: "Minimum household income",
    });
    expect(slider).toHaveAttribute("min", "0");
    expect(slider).toHaveAttribute("max", "300000");
    expect(slider).toHaveAttribute("step", "25000");

    fireEvent.change(slider, { target: { value: "75000" } });
    expect(screen.getByText("$75k")).toBeInTheDocument();
    fireEvent.pointerUp(slider);
    expect(onChange).toHaveBeenCalledWith({ minimumIncome: 75_000 });
  });
});
