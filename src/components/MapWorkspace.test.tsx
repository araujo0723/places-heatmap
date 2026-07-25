import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";

vi.mock("maplibre-gl", () => {
  class MockSource {
    data: unknown;
    constructor(data: unknown) {
      this.data = data;
    }
    setData(data: unknown) {
      this.data = data;
    }
  }

  class MockMap {
    static lastOptions: unknown;
    private handlers = new Map<string, Array<(...args: any[]) => void>>();
    private sources = new Map<string, MockSource>();
    private layers = new Map<string, unknown>();
    private canvas = document.createElement("canvas");
    private center = { lng: -0.115, lat: 51.512 };
    dragRotate = { isEnabled: () => false, enable: vi.fn(), disable: vi.fn() };
    dragPan = { isEnabled: () => true, enable: vi.fn(), disable: vi.fn() };
    doubleClickZoom = { enable: vi.fn(), disable: vi.fn() };

    constructor(options: any) {
      MockMap.lastOptions = options;
      this.center = {
        lng: options.center[0],
        lat: options.center[1],
      };
      queueMicrotask(() => this.emit("load"));
    }
    on(name: string, handler: (...args: any[]) => void) {
      this.handlers.set(name, [...(this.handlers.get(name) ?? []), handler]);
    }
    emit(name: string, value?: unknown) {
      for (const handler of this.handlers.get(name) ?? []) handler(value);
    }
    addControl() {}
    getCanvas() {
      return this.canvas;
    }
    unproject([x, y]: [number, number]) {
      return { lng: x / 100, lat: y / 100 };
    }
    getCenter() {
      return this.center;
    }
    getBounds() {
      const { lng, lat } = this.center;
      return {
        getWest: () => lng - 0.06,
        getSouth: () => lat - 0.04,
        getEast: () => lng + 0.06,
        getNorth: () => lat + 0.04,
      };
    }
    loaded() {
      return true;
    }
    isStyleLoaded() {
      return true;
    }
    addSource(id: string, specification: { data: unknown }) {
      this.sources.set(id, new MockSource(specification.data));
    }
    getSource(id: string) {
      return this.sources.get(id);
    }
    removeSource(id: string) {
      this.sources.delete(id);
    }
    addLayer(layer: { id: string }) {
      this.layers.set(layer.id, layer);
    }
    getLayer(id: string) {
      return this.layers.get(id);
    }
    removeLayer(id: string) {
      this.layers.delete(id);
    }
    stop() {}
    fitBounds() {}
    remove() {}
  }

  class MockGeolocateControl {
    private handlers = new Map<string, Array<(...args: any[]) => void>>();
    on(name: string, handler: (...args: any[]) => void) {
      this.handlers.set(name, [...(this.handlers.get(name) ?? []), handler]);
    }
    trigger() {
      queueMicrotask(() => {
        for (const handler of this.handlers.get("geolocate") ?? []) {
          handler({
            coords: {
              longitude: -73.9857,
              latitude: 40.7484,
              accuracy: 10,
            },
          });
        }
      });
      return true;
    }
  }

  class MockBounds {
    extend() {
      return this;
    }
  }

  return {
    Map: MockMap,
    NavigationControl: class {},
    AttributionControl: class {},
    GeolocateControl: MockGeolocateControl,
    LngLatBounds: MockBounds,
  };
});

vi.mock("terra-draw-maplibre-gl-adapter", () => ({
  TerraDrawMapLibreGLAdapter: class {},
}));

vi.mock("terra-draw", () => {
  class MockDraw {
    private snapshot: unknown[] = [];
    private nextId = 0;
    on() {}
    start() {}
    stop() {}
    setMode() {}
    getSnapshot() {
      return this.snapshot;
    }
    getFeatureId() {
      this.nextId += 1;
      return `mock-region-${this.nextId}`;
    }
    addFeatures(features: any[]) {
      this.snapshot.push(...features);
      return features.map(() => ({ valid: true }));
    }
    hasFeature(id: string | number) {
      return this.snapshot.some((feature: any) => feature.id === id);
    }
    removeFeatures(ids: Array<string | number>) {
      this.snapshot = this.snapshot.filter(
        (feature: any) => !ids.includes(feature.id),
      );
    }
    clear() {
      this.snapshot = [];
    }
  }
  return {
    TerraDraw: MockDraw,
    TerraDrawFreehandMode: class {},
    TerraDrawSelectMode: class {},
  };
});

import MapWorkspace from "./MapWorkspace";
import { Map as MapLibreMap } from "maplibre-gl";

describe("MapWorkspace", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("shows the region preview while the pointer is still down", async () => {
    const user = userEvent.setup();
    render(<MapWorkspace />);

    await user.click(
      await screen.findByRole("button", { name: "Draw region" }),
    );
    const overlay = screen.getByTestId("draw-overlay");
    Object.defineProperties(overlay, {
      getBoundingClientRect: {
        value: () => ({
          left: 0,
          top: 0,
          right: 1000,
          bottom: 700,
          width: 1000,
          height: 700,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        }),
      },
      setPointerCapture: { value: vi.fn() },
      releasePointerCapture: { value: vi.fn() },
    });

    fireEvent.pointerDown(overlay, {
      button: 0,
      clientX: 500,
      clientY: 200,
      isPrimary: true,
      pointerId: 1,
    });
    fireEvent.pointerMove(overlay, {
      clientX: 700,
      clientY: 200,
      isPrimary: true,
      pointerId: 1,
    });
    fireEvent.pointerMove(overlay, {
      clientX: 700,
      clientY: 450,
      isPrimary: true,
      pointerId: 1,
    });

    expect(screen.getByTestId("draw-preview")).toHaveAttribute(
      "d",
      "M 500 200 L 700 200 L 700 450 Z",
    );
    expect(screen.getByTestId("region-count")).toHaveTextContent("0");
    expect(
      screen.getByRole("button", { name: "Draw region" }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("keeps enabled contributions inactive until added and composes them", async () => {
    const user = userEvent.setup();
    render(<MapWorkspace />);

    expect(await screen.findByText("Centered near you")).toBeInTheDocument();
    expect(screen.getByText("No active filters")).toBeInTheDocument();
    expect(screen.getByText("No active heatmaps")).toBeInTheDocument();
    expect(screen.queryByText("Places workspace")).not.toBeInTheDocument();
    expect(screen.queryByText("Explore the map")).not.toBeInTheDocument();

    await user.selectOptions(
      screen.getByLabelText("Heatmap"),
      "demo-places/density",
    );

    await waitFor(() =>
      expect(screen.getByTestId("map-active-summary")).toHaveTextContent(
        "Random heatmap140",
      ),
    );
    expect(screen.getAllByText("Random heatmap")).toHaveLength(2);

    await user.selectOptions(
      screen.getByLabelText("Filter"),
      "demo-places/minimum-weight",
    );
    expect(await screen.findByText("Random area filter")).toBeInTheDocument();
    expect(screen.getByTestId("region-count")).toHaveTextContent("3");

    fireEvent.change(screen.getByRole("slider", { name: "Random coverage" }), {
      target: { value: "10" },
    });
    await waitFor(() =>
      expect(screen.getByTestId("map-active-summary")).not.toHaveTextContent(
        "Random heatmap140",
      ),
    );

    await user.click(
      screen.getByRole("button", { name: "Remove Random area filter" }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("map-active-summary")).toHaveTextContent(
        "Random heatmap140",
      ),
    );
    expect(screen.getByTestId("region-count")).toHaveTextContent("0");

    await user.click(
      screen.getByRole("button", { name: "Remove Random heatmap" }),
    );
    expect(screen.queryByTestId("map-active-summary")).not.toBeInTheDocument();
  });

  it("adds duplicate contributions as independent instances", async () => {
    const user = userEvent.setup();
    render(<MapWorkspace />);

    const selector = await screen.findByLabelText("Heatmap");
    await user.selectOptions(selector, "demo-places/density");
    await user.selectOptions(selector, "demo-places/density");

    await waitFor(() =>
      expect(
        screen.getAllByRole("button", {
          name: "Remove Random heatmap",
        }),
      ).toHaveLength(2),
    );
    expect(screen.getAllByText("Random heatmap")).toHaveLength(4);

    await user.click(
      screen.getAllByRole("button", {
        name: "Remove Random heatmap",
      })[0],
    );
    expect(
      screen.getAllByRole("button", {
        name: "Remove Random heatmap",
      }),
    ).toHaveLength(1);

    const filterSelector = screen.getByLabelText("Filter");
    await user.selectOptions(filterSelector, "demo-places/minimum-weight");
    await user.selectOptions(filterSelector, "demo-places/minimum-weight");
    expect(
      screen.getAllByRole("slider", { name: "Random coverage" }),
    ).toHaveLength(2);

    await user.click(
      screen.getAllByRole("button", {
        name: "Remove Random area filter",
      })[0],
    );
    expect(
      screen.getAllByRole("slider", { name: "Random coverage" }),
    ).toHaveLength(1);
  });

  it("starts at and refreshes the saved location without animation", async () => {
    localStorage.setItem(
      "places-heatmap:last-location",
      JSON.stringify({ longitude: 2.3522, latitude: 48.8566 }),
    );

    render(<MapWorkspace />);

    const options = (
      MapLibreMap as unknown as {
        lastOptions: {
          center: [number, number];
        };
      }
    ).lastOptions;
    expect(options.center).toEqual([2.3522, 48.8566]);
    expect(
      screen.getByText("Centered at your last known location"),
    ).toBeInTheDocument();

    await screen.findByText("Centered near you");
    expect(
      JSON.parse(
        localStorage.getItem("places-heatmap:last-location") ?? "null",
      ),
    ).toEqual({ longitude: -73.9857, latitude: 40.7484 });
  });
});
