import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
    private zoom = 0;
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
      this.zoom = options.zoom;
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
      return {
        lng: this.center.lng + (x - 500) / 10_000,
        lat: this.center.lat + (350 - y) / 10_000,
      };
    }
    getCenter() {
      return this.center;
    }
    setCenter(center: [number, number]) {
      this.center = { lng: center[0], lat: center[1] };
    }
    jumpTo = vi.fn(
      (options: { center: [number, number]; zoom: number }) => {
        this.center = {
          lng: options.center[0],
          lat: options.center[1],
        };
        this.zoom = options.zoom;
      },
    );
    getZoom() {
      return this.zoom;
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
    setPaintProperty(id: string, property: string, value: unknown) {
      const layer = this.layers.get(id) as
        | { paint?: Record<string, unknown> }
        | undefined;
      if (layer) layer.paint = { ...layer.paint, [property]: value };
    }
    setLayoutProperty(id: string, property: string, value: unknown) {
      const layer = this.layers.get(id) as
        | { layout?: Record<string, unknown> }
        | undefined;
      if (layer) layer.layout = { ...layer.layout, [property]: value };
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
    _updateCamera?: (position: GeolocationPosition) => void;
    on(name: string, handler: (...args: any[]) => void) {
      this.handlers.set(name, [...(this.handlers.get(name) ?? []), handler]);
    }
    trigger() {
      queueMicrotask(() => {
        const position = {
          coords: {
            longitude: -73.9857,
            latitude: 40.7484,
            accuracy: 10,
          },
        } as GeolocationPosition;
        this._updateCamera?.(position);
        for (const handler of this.handlers.get("geolocate") ?? []) {
          handler(position);
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
    TerraDrawRectangleMode: class {},
    TerraDrawSelectMode: class {},
  };
});

import MapWorkspace from "./MapWorkspace";
import { Map as MapLibreMap } from "maplibre-gl";
import { clearNearbyParkCache } from "../extensions/nearby-parks/data";
import { clearNearbyWaterCache } from "../extensions/nearby-water/data";

async function drawArea(user: ReturnType<typeof userEvent.setup>) {
  await user.click(
    await screen.findByRole("button", { name: "Draw area" }),
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
    clientY: 450,
    isPrimary: true,
    pointerId: 1,
  });
  fireEvent.pointerUp(overlay, {
    clientX: 700,
    clientY: 450,
    isPrimary: true,
    pointerId: 1,
  });
  await waitFor(() =>
    expect(screen.getByTestId("area-of-interest-count")).toHaveTextContent("1"),
  );
}

describe("MapWorkspace", () => {
  beforeEach(() => {
    localStorage.clear();
    clearNearbyParkCache();
    clearNearbyWaterCache();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("dismisses snack notifications after five seconds", async () => {
    vi.useFakeTimers();
    render(<MapWorkspace />);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByTestId("location-status")).toHaveTextContent(
      "Centered near you",
    );

    act(() => {
      vi.advanceTimersByTime(4_999);
    });
    expect(screen.getByTestId("location-status")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByTestId("location-status")).not.toBeInTheDocument();
  });

  it(
    "shows a rectangular region preview while the pointer is still down",
    async () => {
      const user = userEvent.setup();
      render(<MapWorkspace />);

      await user.click(
        await screen.findByRole("button", { name: "Draw area" }),
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
        "M 500 200 L 700 200 L 700 450 L 500 450 Z",
      );
      expect(screen.getByTestId("draw-preview")).toHaveAttribute("fill", "none");
      expect(screen.getByTestId("draw-preview")).toHaveAttribute(
        "stroke",
        "#64748b",
      );
      expect(screen.getByTestId("draw-preview")).toHaveAttribute(
        "stroke-dasharray",
        "2 4",
      );
      expect(screen.getByTestId("area-of-interest-count")).toHaveTextContent(
        "0",
      );
      expect(
        screen.getByRole("button", { name: "Draw area" }),
      ).toHaveAttribute("aria-pressed", "true");
    },
  );

  it("mutes the map outside the Area of Interest", async () => {
    const user = userEvent.setup();
    render(<MapWorkspace />);

    await drawArea(user);

    const map = (
      MapLibreMap as unknown as {
        lastInstance: {
          getLayer(id: string): unknown;
          getSource(id: string): { data: FeatureCollection } | undefined;
        };
      }
    ).lastInstance;
    expect(map.getLayer("area-of-interest-outside-mask")).toMatchObject({
      type: "fill",
      paint: {
        "fill-color": "#64748b",
        "fill-opacity": 0.48,
      },
    });
    const mask = map.getSource("area-of-interest-mask-source")?.data;
    expect(mask?.features).toHaveLength(1);
    expect(mask?.features[0].geometry.type).toBe("Polygon");
    if (mask?.features[0].geometry.type === "Polygon") {
      expect(mask.features[0].geometry.coordinates).toHaveLength(2);
    }
  });

  it("rejects an Area of Interest over 50 miles across", async () => {
    const user = userEvent.setup();
    render(<MapWorkspace />);

    await user.click(
      await screen.findByRole("button", { name: "Draw area" }),
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
      clientX: 20_500,
      clientY: 450,
      isPrimary: true,
      pointerId: 1,
    });
    fireEvent.pointerUp(overlay, {
      clientX: 20_500,
      clientY: 450,
      isPrimary: true,
      pointerId: 1,
    });

    expect(screen.getByTestId("area-of-interest-count")).toHaveTextContent("0");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "It cannot be more than 50 miles.",
    );
    expect(screen.getByRole("button", { name: "Draw area" }))
      .toBeInTheDocument();
  });

  it("exposes the Zillow action and nearby-area data contributions", async () => {
    render(<MapWorkspace />);

    expect(await screen.findByText("Centered near you")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "GO TO ZILLOW" }),
    ).toBeDisabled();
    expect(screen.getByText("Define an Area of Interest first."))
      .toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "RESET WORKSPACE" }),
    ).toBeDisabled();
    expect(screen.getByLabelText("Filter")).toBeDisabled();
    expect(screen.getByLabelText("Heatmap")).toBeDisabled();
    expect(screen.getByText("No active filters")).toBeInTheDocument();
    expect(screen.getByText("No active heatmaps")).toBeInTheDocument();
    expect(screen.getByLabelText("Filter")).toHaveTextContent(
      "Nearby parks · Park distance",
    );
    expect(screen.getByLabelText("Filter")).toHaveTextContent(
      "Nearby water · Water distance",
    );
    expect(screen.getByLabelText("Filter")).toHaveTextContent(
      "Commute time · Commute time",
    );
    expect(screen.getByLabelText("Heatmap")).toHaveTextContent(
      "Nearby parks · Park influence",
    );
    expect(screen.getByLabelText("Heatmap")).toHaveTextContent(
      "Nearby water · Water influence",
    );
    expect(screen.getByLabelText("Heatmap")).toHaveTextContent(
      "Commute time · Commute time",
    );
    expect(screen.queryByText(/demo-places/i)).not.toBeInTheDocument();
  });

  it("requires confirmation before resetting the full workspace", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ tiles: [], parks: [] })),
    );
    const user = userEvent.setup();
    render(<MapWorkspace />);

    await drawArea(user);
    await user.selectOptions(
      screen.getByLabelText("Filter"),
      "nearby-parks/distance",
    );
    await user.selectOptions(
      screen.getByLabelText("Heatmap"),
      "nearby-parks/influence",
    );

    const resetButton = screen.getByRole("button", {
      name: "RESET WORKSPACE",
    });
    expect(resetButton).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Draw area" }))
      .not.toBeInTheDocument();

    await user.click(resetButton);
    expect(
      screen.getByRole("dialog", { name: "Reset the workspace?" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByTestId("area-of-interest-count")).toHaveTextContent("1");

    await user.click(resetButton);
    await user.click(
      screen.getByRole("button", { name: "Reset everything" }),
    );

    expect(screen.getByTestId("area-of-interest-count")).toHaveTextContent("0");
    expect(screen.getByRole("button", { name: "Draw area" })).toBeEnabled();
    expect(screen.getByLabelText("Filter")).toBeDisabled();
    expect(screen.getByLabelText("Heatmap")).toBeDisabled();
    expect(screen.getByText("No active filters")).toBeInTheDocument();
    expect(screen.getByText("No active heatmaps")).toBeInTheDocument();
    expect(resetButton).toBeDisabled();
  });

  it("keeps the current area active until a redefined area is valid", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ tiles: [], parks: [] }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<MapWorkspace />);

    await screen.findByText("Centered near you");
    (
      MapLibreMap as unknown as {
        lastInstance: { setCenter(center: [number, number]): void };
      }
    ).lastInstance.setCenter([-0.115, 51.512]);
    await drawArea(user);
    await user.selectOptions(
      screen.getByLabelText("Filter"),
      "nearby-parks/distance",
    );
    await screen.findByText("Active");
    const requestCount = fetchMock.mock.calls.length;
    const map = (
      MapLibreMap as unknown as {
        lastInstance: {
          setCenter(center: [number, number]): void;
        };
      }
    ).lastInstance;
    map.setCenter([1, 52]);

    await user.click(screen.getByRole("button", { name: "Redefine area" }));
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
      pointerId: 2,
    });
    fireEvent.pointerMove(overlay, {
      clientX: 700,
      clientY: 450,
      isPrimary: true,
      pointerId: 2,
    });

    expect(screen.getByTestId("area-of-interest-count")).toHaveTextContent("1");
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(requestCount);

    fireEvent.pointerUp(overlay, {
      clientX: 700,
      clientY: 450,
      isPrimary: true,
      pointerId: 2,
    });
    await waitFor(() =>
      expect(fetchMock.mock.calls.length).toBeGreaterThan(requestCount),
    );
    expect(
      screen.getByRole("button", { name: "Redefine area" }),
    ).toHaveAttribute("aria-pressed", "false");
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

    await drawArea(user);

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

  it("renders park layers inside the Area of Interest without reloading on map movement", async () => {
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

    await screen.findByText("Centered near you");
    (
      MapLibreMap as unknown as {
        lastInstance: { setCenter(center: [number, number]): void };
      }
    ).lastInstance.setCenter([-0.115, 51.512]);
    await drawArea(user);
    const filterSelector = await screen.findByLabelText("Filter");
    const map = (
      MapLibreMap as unknown as {
        lastInstance: {
          emit(name: string): void;
          getLayer(id: string): unknown;
          getSource(id: string): { data: FeatureCollection } | undefined;
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
      expect(
        map.getSource("filter-owned-regions-source")?.data.features,
      ).toHaveLength(1),
    );
    expect(
      map.getSource("filter-owned-regions-source")?.data.features[0].geometry
        .type,
    ).toBe("MultiPolygon");

    const parkDistanceSlider = screen.getByRole("slider", {
      name: "Park distance",
    });
    fireEvent.change(parkDistanceSlider, { target: { value: "150" } });
    fireEvent.change(parkDistanceSlider, { target: { value: "0" } });
    expect(screen.getByText("0 m")).toBeInTheDocument();
    await new Promise((resolve) => window.setTimeout(resolve, 300));
    expect(
      map.getSource("filter-owned-regions-source")?.data.features[0].geometry
        .type,
    ).toBe("MultiPolygon");

    fireEvent.pointerUp(parkDistanceSlider);
    await waitFor(
      () =>
        expect(
          map.getSource("filter-owned-regions-source")?.data.features[0]
            .geometry.type,
        ).toBe("Polygon"),
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
    expect(screen.queryByText("Nearby parks")).not.toBeInTheDocument();
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
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("draws only the common boundary of park and water filters", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).startsWith("/api/parks?")) {
          return Response.json({
            tiles: [],
            parks: [
              {
                id: "way/park",
                center: [-73.98, 40.75],
                bbox: {
                  west: -73.985,
                  south: 40.74,
                  east: -73.975,
                  north: 40.76,
                },
              },
            ],
          });
        }
        return Response.json({
          tiles: [],
          waters: [
            {
              id: "way/water",
              center: [-73.975, 40.75],
              bbox: {
                west: -73.98,
                south: 40.745,
                east: -73.97,
                north: 40.755,
              },
            },
          ],
        });
      }),
    );
    const user = userEvent.setup();
    render(<MapWorkspace />);

    await screen.findByText("Centered near you");
    await drawArea(user);
    await user.selectOptions(
      screen.getByLabelText("Filter"),
      "nearby-parks/distance",
    );
    await screen.findByText("Active");
    await user.selectOptions(
      screen.getByLabelText("Filter"),
      "nearby-water/distance",
    );
    await waitFor(() =>
      expect(screen.getAllByText("Active")).toHaveLength(2),
    );

    const map = (
      MapLibreMap as unknown as {
        lastInstance: {
          getSource(id: string): { data: FeatureCollection } | undefined;
        };
      }
    ).lastInstance;
    await waitFor(() =>
      expect(
        map.getSource("filter-owned-regions-source")?.data.features,
      ).toHaveLength(1),
    );
    expect(
      map.getSource("filter-owned-regions-source")?.data.features[0].properties,
    ).toMatchObject({
      __hostFillColor: "#2563eb",
      __hostLineColor: "#1d4ed8",
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

    await drawArea(user);
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
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, _init?: RequestInit) => {
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
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<MapWorkspace />);

    await screen.findByText("Centered near you");
    (
      MapLibreMap as unknown as {
        lastInstance: { setCenter(center: [number, number]): void };
      }
    ).lastInstance.setCenter([-84.35, 33.75]);
    await drawArea(user);
    await user.selectOptions(
      await screen.findByLabelText("Filter"),
      "commute/time",
    );
    const addressInput = screen.getByRole("textbox", {
      name: "Commute address",
    });
    await user.type(addressInput, "Peachtree");
    const suggestionRequest = await waitFor(() => {
      const request = fetchMock.mock.calls.find(([input]) =>
        String(input).startsWith("/api/address-suggestions"),
      );
      expect(request).toBeDefined();
      return String(request?.[0]);
    });
    const suggestionParameters = new URL(
      suggestionRequest,
      "http://localhost",
    ).searchParams;
    expect(Number(suggestionParameters.get("longitude"))).toBeCloseTo(
      -84.34,
      2,
    );
    expect(Number(suggestionParameters.get("latitude"))).toBeCloseTo(
      33.7525,
      2,
    );
    await user.click(
      await screen.findByRole(
        "button",
        { name: "1 Peachtree St, Atlanta, GA" },
        { timeout: 2_000 },
      ),
    );

    await screen.findByText("Active");
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
    const commuteSlider = screen.getByRole("slider", {
      name: "Commute time",
    });
    const isochroneRequestCount = () =>
      fetchMock.mock.calls.filter(
        ([input]) => String(input) === "/api/commute/isochrones",
      ).length;
    expect(isochroneRequestCount()).toBe(1);

    fireEvent.change(commuteSlider, { target: { value: "35" } });
    fireEvent.change(commuteSlider, { target: { value: "40" } });
    expect(screen.getByText("40 min")).toBeInTheDocument();
    await new Promise((resolve) => window.setTimeout(resolve, 300));
    expect(isochroneRequestCount()).toBe(1);

    fireEvent.pointerUp(commuteSlider);
    await waitFor(() => expect(isochroneRequestCount()).toBe(2));
    const latestIsochroneRequest = fetchMock.mock.calls
      .filter(([input]) => String(input) === "/api/commute/isochrones")
      .at(-1)?.[1] as RequestInit;
    expect(JSON.parse(String(latestIsochroneRequest.body))).toMatchObject({
      minutes: [40],
    });

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

    await drawArea(user);
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

  it("uses the same wider zoom for saved and newly located positions", async () => {
    localStorage.setItem(
      "places-heatmap:last-location",
      JSON.stringify({ longitude: 2.3522, latitude: 48.8566 }),
    );

    render(<MapWorkspace />);

    const options = (
      MapLibreMap as unknown as {
        lastOptions: {
          center: [number, number];
          zoom: number;
        };
      }
    ).lastOptions;
    expect(options.center).toEqual([2.3522, 48.8566]);
    expect(options.zoom).toBe(11.3);
    expect(
      screen.getByText("Centered at your last known location"),
    ).toBeInTheDocument();

    await screen.findByText("Centered near you");
    const map = (
      MapLibreMap as unknown as {
        lastInstance: {
          jumpTo: ReturnType<typeof vi.fn>;
          getZoom(): number;
        };
      }
    ).lastInstance;
    expect(map.jumpTo).toHaveBeenCalledWith({
      center: [-73.9857, 40.7484],
      zoom: 11.3,
    });
    expect(map.getZoom()).toBe(11.3);
    expect(
      JSON.parse(
        localStorage.getItem("places-heatmap:last-location") ?? "null",
      ),
    ).toEqual({ longitude: -73.9857, latitude: 40.7484 });
  });

  it("does not recenter when geolocation matches the saved location", async () => {
    localStorage.setItem(
      "places-heatmap:last-location",
      JSON.stringify({ longitude: -73.9857, latitude: 40.7484 }),
    );

    render(<MapWorkspace />);
    await screen.findByText("Centered near you");

    const map = (
      MapLibreMap as unknown as {
        lastInstance: {
          jumpTo: ReturnType<typeof vi.fn>;
          getZoom(): number;
        };
      }
    ).lastInstance;
    expect(map.jumpTo).not.toHaveBeenCalled();
    expect(map.getZoom()).toBe(11.3);
  });
});
