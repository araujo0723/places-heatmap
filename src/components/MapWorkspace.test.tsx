import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { FeatureCollection } from "geojson";
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
    static lastInstance: MockMap;
    private handlers = new Map<string, Array<(...args: any[]) => void>>();
    private sources = new Map<string, MockSource>();
    private layers = new Map<string, unknown>();
    private canvas = document.createElement("canvas");
    private center = { lng: -0.115, lat: 51.512 };
    private styleLoaded = true;
    dragRotate = { isEnabled: () => false, enable: vi.fn(), disable: vi.fn() };
    dragPan = { isEnabled: () => true, enable: vi.fn(), disable: vi.fn() };
    doubleClickZoom = { enable: vi.fn(), disable: vi.fn() };

    constructor(options: any) {
      MockMap.lastOptions = options;
      MockMap.lastInstance = this;
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
    setCenter(center: [number, number]) {
      this.center = { lng: center[0], lat: center[1] };
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
      return this.styleLoaded;
    }
    setStyleLoaded(value: boolean) {
      this.styleLoaded = value;
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
import { clearNearbyParkCache } from "../extensions/nearby-parks/data";

describe("MapWorkspace", () => {
  beforeEach(() => {
    localStorage.clear();
    clearNearbyParkCache();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
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

  it("exposes the Zillow action and nearby-parks data contributions", async () => {
    render(<MapWorkspace />);

    expect(await screen.findByText("Centered near you")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "GO TO ZILLOW" }),
    ).toBeDisabled();
    expect(screen.getByText("Draw or activate a region boundary first."))
      .toBeInTheDocument();
    expect(screen.getByText("No active filters")).toBeInTheDocument();
    expect(screen.getByText("No active heatmaps")).toBeInTheDocument();
    expect(screen.getByLabelText("Filter")).toHaveTextContent(
      "Nearby parks · Park distance",
    );
    expect(screen.getByLabelText("Filter")).toHaveTextContent(
      "Commute time · Commute time",
    );
    expect(screen.getByLabelText("Heatmap")).toHaveTextContent(
      "Nearby parks · Park influence",
    );
    expect(screen.getByLabelText("Heatmap")).toHaveTextContent(
      "Commute time · Commute time",
    );
    expect(screen.queryByText(/demo-places/i)).not.toBeInTheDocument();
  });

  it("creates the drawn boundary in Zillow before opening a new tab", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        Response.json({ customRegionId: "saved-region" }),
    );
    const openMock = vi
      .spyOn(window, "open")
      .mockImplementation(() => null);
    vi.stubGlobal("fetch", fetchMock);
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
    for (const [clientX, clientY] of [
      [700, 200],
      [700, 450],
      [500, 450],
    ]) {
      fireEvent.pointerMove(overlay, {
        clientX,
        clientY,
        isPrimary: true,
        pointerId: 1,
      });
    }
    fireEvent.pointerUp(overlay, {
      clientX: 500,
      clientY: 200,
      isPrimary: true,
      pointerId: 1,
    });

    const zillowButton = screen.getByRole("button", {
      name: "GO TO ZILLOW",
    });
    await waitFor(() => expect(zillowButton).toBeEnabled());
    await user.click(zillowButton);
    await waitFor(() => expect(openMock).toHaveBeenCalledTimes(1));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/zillow/custom-region",
      expect.objectContaining({ method: "POST" }),
    );
    const request = fetchMock.mock.calls[0][1] as RequestInit;
    const payload = JSON.parse(String(request.body)) as {
      polygons: Array<Array<[number, number]>>;
    };
    expect(payload.polygons).toHaveLength(1);
    expect(payload.polygons[0][0]).toEqual(payload.polygons[0].at(-1));
    expect(openMock.mock.calls[0][0]).toContain(
      "https://www.zillow.com/homes/for_rent/",
    );
    expect(openMock.mock.calls[0].slice(1)).toEqual([
      "_blank",
      "noopener,noreferrer",
    ]);
  });

  it("renders park layers immediately while the base style is busy, then refreshes after movement", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        tiles: [],
        parks: [
          {
            id: "way/1",
            name: "Box Park",
            center: [-0.115, 51.512],
            bbox: {
              west: -0.12,
              south: 51.51,
              east: -0.11,
              north: 51.515,
            },
          },
          {
            id: "node/2",
            name: "Point Park",
            center: [-0.1, 51.52],
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<MapWorkspace />);

    const filterSelector = await screen.findByLabelText("Filter");
    const map = (
      MapLibreMap as unknown as {
        lastInstance: {
          emit(name: string): void;
          getLayer(id: string): unknown;
          setCenter(center: [number, number]): void;
          setStyleLoaded(value: boolean): void;
        };
      }
    ).lastInstance;
    map.setStyleLoaded(false);

    await user.selectOptions(
      filterSelector,
      "nearby-parks/distance",
    );
    await waitFor(() =>
      expect(screen.getByTestId("region-count")).toHaveTextContent("2"),
    );
    expect(screen.getByText(/2 filter-owned regions/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear all" })).toBeDisabled();

    fireEvent.change(screen.getByRole("slider", { name: "Park distance" }), {
      target: { value: "0" },
    });
    await waitFor(
      () => expect(screen.getByTestId("region-count")).toHaveTextContent("1"),
      { timeout: 2_000 },
    );

    await user.selectOptions(
      screen.getByLabelText("Heatmap"),
      "nearby-parks/influence",
    );
    await waitFor(
      () =>
        expect(screen.getByTestId("map-active-summary")).toHaveTextContent(
          "Park influence2",
        ),
      { timeout: 5_000 },
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);

    expect(map.getLayer("filter-owned-regions-fill")).toMatchObject({
      paint: {
        "fill-color": [
          "coalesce",
          ["get", "__hostFillColor"],
          "#16a34a",
        ],
      },
    });
    expect(map.getLayer("filter-owned-regions-line")).toMatchObject({
      paint: {
        "line-color": [
          "coalesce",
          ["get", "__hostLineColor"],
          "#15803d",
        ],
      },
    });
    expect(map.getLayer("extension-surface-heatmap-2")).toMatchObject({
      paint: {
        "fill-color": [
          "interpolate",
          ["linear"],
          ["get", "weight"],
          0,
          "rgba(22, 163, 74, 0)",
          1,
          "rgba(22, 163, 74, 1)",
        ],
      },
    });

    map.setStyleLoaded(true);
    map.setCenter([1, 52]);
    map.emit("moveend");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2), {
      timeout: 3_000,
    });
  });

  it("allows duplicate park heatmap instances", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          tiles: [],
          parks: [],
        }),
      ),
    );
    const user = userEvent.setup();
    render(<MapWorkspace />);

    const selector = await screen.findByLabelText("Heatmap");
    await user.selectOptions(selector, "nearby-parks/influence");
    await user.selectOptions(selector, "nearby-parks/influence");

    await waitFor(() =>
      expect(
        screen.getAllByRole("button", {
          name: "Remove Park influence",
        }),
      ).toHaveLength(2),
    );

    await user.click(
      screen.getAllByRole("button", {
        name: "Remove Park influence",
      })[0],
    );
    expect(
      screen.getAllByRole("button", {
        name: "Remove Park influence",
      }),
    ).toHaveLength(1);
  });

  it("looks up a commute address and draws the selected red filter outline", async () => {
    const polygon = [
      [-84.5, 33.6],
      [-84.2, 33.6],
      [-84.2, 33.9],
      [-84.5, 33.9],
      [-84.5, 33.6],
    ];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).startsWith("/api/address-suggestions")) {
        return Response.json({
          suggestions: [
            {
              label: "1 Peachtree St, Atlanta, GA",
              address: "1 Peachtree St, Atlanta, GA",
              center: [-84.388, 33.749],
            },
          ],
        });
      }
      return Response.json({
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            geometry: { type: "Polygon", coordinates: [polygon] },
            properties: { minutes: 30 },
          },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<MapWorkspace />);

    await user.selectOptions(
      await screen.findByLabelText("Filter"),
      "commute/time",
    );
    const addressInput = screen.getByRole("textbox", {
      name: "Commute address",
    });
    await user.type(addressInput, "Peachtree");
    await user.click(
      await screen.findByRole(
        "button",
        { name: "1 Peachtree St, Atlanta, GA" },
        { timeout: 2_000 },
      ),
    );

    await waitFor(() =>
      expect(screen.getByTestId("region-count")).toHaveTextContent("1"),
    );
    expect(screen.getByRole("slider", { name: "Commute time" })).toHaveAttribute(
      "min",
      "5",
    );
    expect(screen.getByRole("slider", { name: "Commute time" })).toHaveAttribute(
      "max",
      "60",
    );
    expect(screen.getByRole("slider", { name: "Commute time" })).toHaveAttribute(
      "step",
      "5",
    );

    const map = (
      MapLibreMap as unknown as {
        lastInstance: {
          getSource(id: string): { data: FeatureCollection } | undefined;
        };
      }
    ).lastInstance;
    expect(
      map.getSource("filter-owned-regions-source")?.data.features[0].properties,
    ).toMatchObject({
      __hostFillColor: "#dc2626",
      __hostLineColor: "#dc2626",
      __hostLineWidth: 2.5,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/commute/isochrones",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("exposes only the address control for the commute heatmap", async () => {
    const user = userEvent.setup();
    render(<MapWorkspace />);

    await user.selectOptions(
      await screen.findByLabelText("Heatmap"),
      "commute/travel-time",
    );

    expect(
      screen.getByRole("textbox", { name: "Commute address" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("slider", { name: "Commute time" }),
    ).not.toBeInTheDocument();
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
