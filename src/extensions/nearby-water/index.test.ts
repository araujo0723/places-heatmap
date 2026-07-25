import extension from "./index";

describe("nearby water extension", () => {
  it("uses blue styling for its filter and influence heatmap", () => {
    expect(extension.filters?.[0].regionStyle).toMatchObject({
      fillColor: "#2563eb",
      lineColor: "#1d4ed8",
    });
    expect(extension.heatmaps?.[0].style.colorRamp).toEqual([
      [0, "rgba(37, 99, 235, 0)"],
      [1, "rgba(37, 99, 235, 1)"],
    ]);
  });
});
