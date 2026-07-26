import extension from "./index";

describe("commute extension", () => {
  it("uses the 20-min label and subdued green and yellow styling", () => {
    expect(extension.icon).toBe("/icons/car.svg");
    expect(extension.heatmaps?.[0]).toMatchObject({
      name: "Commute (20-min layers)",
      style: {
        opacity: 0.5,
        colorRamp: [
          [0, "#facc15"],
          [1, "#16a34a"],
        ],
      },
    });
  });
});
