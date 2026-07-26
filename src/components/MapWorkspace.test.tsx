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
    setPadding = vi.fn();
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
            longitude: -0.115,
            latitude: 51.512,
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

import MapWorkspace from "./MapWorkspace";
import { Map as MapLibreMap } from "maplibre-gl";
import { extensionRegistry } from "../extensions/registry";

const optionalExtensionDataModules = import.meta.glob(
  "../extensions/*/data.ts",
  { eager: true },
) as Record<string, Record<string, unknown>>;

function clearOptionalExtensionCaches() {
  for (const module of Object.values(optionalExtensionDataModules)) {
    for (const [name, value] of Object.entries(module)) {
      if (/^clear.*Cache$/.test(name) && typeof value === "function") {
        value();
      }
    }
  }
}

async function drawArea(user: ReturnType<typeof userEvent.setup>) {
  void user;
  await waitFor(() =>
    expect(screen.getByTestId("area-of-interest-count")).toHaveTextContent("1"),
  );
}

const contributionLabels: Record<string, string> = {
  "nearby-parks/distance": "Parks",
  "nearby-water/distance": "Lakes",
  "commute/time": "Commute",
  "nearby-parks/influence": "Parks",
  "nearby-water/influence": "Lakes",
  "commute/travel-time": "Commute",
  "test/reject-all": "Reject all",
  "test/points": "Test points",
};

async function addContribution(
  user: ReturnType<typeof userEvent.setup>,
  type: "Filter" | "Heatmap",
  key: string,
) {
  await user.click(screen.getByRole("button", { name: `Add ${type}` }));
  await user.click(
    screen.getByRole("menuitem", { name: contributionLabels[key] }),
  );
}

describe("MapWorkspace", () => {
  beforeEach(() => {
    localStorage.clear();
    clearOptionalExtensionCaches();
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

  it("sets a new origin from address autocomplete", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          suggestions: [
            {
              label: "1 Peachtree St, Atlanta, GA",
              address: "1 Peachtree St, Atlanta, GA",
              center: [-84.388, 33.749],
            },
          ],
        }),
      ),
    );
    const user = userEvent.setup();
    render(<MapWorkspace />);

    await screen.findByText("Centered near you");
    await user.click(screen.getByRole("button", { name: "Set origin" }));
    expect(
      screen.getByRole("dialog", { name: "Set origin" }),
    ).toBeInTheDocument();
    await user.type(
      screen.getByRole("textbox", { name: "Origin address" }),
      "Peachtree",
    );
    await user.click(
      await screen.findByRole("button", {
        name: "1 Peachtree St, Atlanta, GA",
      }),
    );

    const map = (
      MapLibreMap as unknown as {
        lastInstance: { jumpTo: ReturnType<typeof vi.fn> };
      }
    ).lastInstance;
    expect(map.jumpTo).toHaveBeenLastCalledWith({
      center: [-84.388, 33.749],
      zoom: 10,
    });
    expect(screen.queryByRole("dialog", { name: "Set origin" })).not
      .toBeInTheDocument();
  });

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

  it("automatically creates an Area of Interest 20 miles in every direction", async () => {
    render(<MapWorkspace />);

    await screen.findByText("Centered near you");
    const map = (
      MapLibreMap as unknown as {
        lastInstance: {
          getSource(id: string): { data: FeatureCollection } | undefined;
        };
      }
    ).lastInstance;
    const mask = map.getSource("area-of-interest-mask-source")?.data;
    const ring =
      mask?.features[0]?.geometry.type === "Polygon"
        ? mask.features[0].geometry.coordinates[1]
        : [];
    const latitudes = ring.map((position) => position[1]);
    expect(Math.max(...latitudes) - 51.512).toBeCloseTo(0.289, 2);
    expect(51.512 - Math.min(...latitudes)).toBeCloseTo(0.289, 2);
    expect(screen.getByTestId("area-of-interest-count")).toHaveTextContent("1");
  });

  it("exposes the Zillow action and nearby-area data contributions", async () => {
    render(<MapWorkspace />);

    expect(await screen.findByText("Centered near you")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "GO TO ZILLOW" }),
    ).toBeEnabled();
    expect(
      screen
        .getByRole("button", { name: "GO TO ZILLOW" })
        .querySelector('img[src="/icons/house.svg"]'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Set origin" }),
    ).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "Add Filter" }),
    ).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "Add Heatmap" }),
    ).toBeEnabled();
    expect(screen.getByText("No active filters")).toBeInTheDocument();
    expect(screen.getByText("No active heatmaps")).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Area of interest" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("Define an Area of Interest first."),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/demo-places/i)).not.toBeInTheDocument();
  });

  it("confirms RESET ALL and preserves the Area of Interest", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ tiles: [], parks: [] })),
    );
    const user = userEvent.setup();
    render(<MapWorkspace />);

    await drawArea(user);
    await addContribution(user, "Filter", "nearby-parks/distance");
    await addContribution(user, "Heatmap", "nearby-parks/influence");

    const resetAllButton = screen.getByRole("button", {
      name: "RESET ALL",
    });
    await user.click(resetAllButton);
    expect(
      screen.getByRole("dialog", {
        name: "Reset all filters and heatmaps?",
      }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByTestId("area-of-interest-count")).toHaveTextContent("1");
    expect(
      screen.getByRole("button", { name: "Remove Parks filter" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Remove Parks heatmap" }),
    ).toBeInTheDocument();

    await user.click(resetAllButton);
    await user.click(screen.getByRole("button", { name: "Reset all" }));

    expect(
      screen.getByRole("button", { name: "Set origin" }),
    ).toBeEnabled();
    expect(screen.getByText("No active filters")).toBeInTheDocument();
    expect(screen.getByText("No active heatmaps")).toBeInTheDocument();
    expect(resetAllButton).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: "Clear all filters" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Clear all heatmaps" }),
    ).not.toBeInTheDocument();
  });

  it("recalculates active contributions after the origin changes", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) =>
      String(input).startsWith("/api/address-suggestions")
        ? Response.json({
            suggestions: [
              {
                label: "Paris, France",
                address: "Paris, France",
                center: [2.3522, 48.8566],
              },
            ],
          })
        : Response.json({ tiles: [], parks: [] }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<MapWorkspace />);

    await screen.findByText("Centered near you");
    await drawArea(user);
    await addContribution(user, "Filter", "nearby-parks/distance");
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.filter(([input]) =>
          String(input).startsWith("/api/parks?"),
        ),
      ).toHaveLength(1),
    );
    const initialParkRequestCount = fetchMock.mock.calls.filter(([input]) =>
      String(input).startsWith("/api/parks?"),
    ).length;
    await waitFor(() =>
      expect(screen.queryByText("Loading")).not.toBeInTheDocument(),
    );

    await user.click(
      screen.getByRole("button", { name: "Set origin" }),
    );
    await user.type(
      screen.getByRole("textbox", { name: "Origin address" }),
      "Paris",
    );
    await user.click(
      await screen.findByRole("button", { name: "Paris, France" }),
    );
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.filter(([input]) =>
          String(input).startsWith("/api/parks?"),
        ).length,
      ).toBeGreaterThan(initialParkRequestCount),
    );
    expect(screen.getByTestId("area-of-interest-count")).toHaveTextContent("1");
  });

  it("creates the Area of Interest in Zillow before opening a new tab", async () => {
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

    await addContribution(user, "Filter", "nearby-parks/distance");
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

    await addContribution(user, "Heatmap", "nearby-parks/influence");
    await waitFor(
      () =>
        expect(screen.getByTestId("map-active-summary")).toHaveTextContent(
          "Parks2",
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
    expect(
      map.getSource("extension-source-heatmap-2")?.data.features.length,
    ).toBeGreaterThan(1);

    map.setStyleLoaded(true);
    map.setCenter([1, 52]);
    map.emit("moveend");
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("shows status only while a filter is loading or reloading", async () => {
    const pendingResponses: Array<(response: Response) => void> = [];
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          pendingResponses.push(resolve);
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<MapWorkspace />);

    await screen.findByText("Centered near you");
    await drawArea(user);
    await addContribution(user, "Filter", "nearby-parks/distance");

    expect(await screen.findByText("Loading")).toBeInTheDocument();
    expect(screen.queryByText("Active")).not.toBeInTheDocument();
    expect(screen.queryByText("Off")).not.toBeInTheDocument();

    await act(async () => {
      for (const resolve of pendingResponses.splice(0)) {
        resolve(Response.json({ tiles: [], parks: [] }));
      }
    });
    await waitFor(() =>
      expect(screen.queryByText("Loading")).not.toBeInTheDocument(),
    );
    expect(screen.queryByText("Active")).not.toBeInTheDocument();

    clearOptionalExtensionCaches();
    const slider = screen.getByRole("slider", { name: "Park distance" });
    fireEvent.change(slider, { target: { value: "350" } });
    fireEvent.pointerUp(slider);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(screen.getByText("Loading")).toBeInTheDocument();

    await act(async () => {
      for (const resolve of pendingResponses.splice(0)) {
        resolve(Response.json({ tiles: [], parks: [] }));
      }
    });
    await waitFor(() =>
      expect(screen.queryByText("Loading")).not.toBeInTheDocument(),
    );
    expect(screen.queryByText("Active")).not.toBeInTheDocument();
    expect(screen.queryByText("Off")).not.toBeInTheDocument();
  });

  it("toggles a filter immediately without reloading its data", async () => {
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
    await addContribution(user, "Filter", "nearby-parks/distance");

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
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Active")).not.toBeInTheDocument();

    const toggle = screen.getByRole("switch", {
      name: "Parks enabled",
    });
    expect(toggle).toHaveAttribute("aria-checked", "true");

    await user.click(toggle);

    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(screen.queryByText("Off")).not.toBeInTheDocument();
    expect(
      screen.getByRole("slider", { name: "Park distance" }),
    ).toBeDisabled();
    await waitFor(() =>
      expect(
        map.getSource("filter-owned-regions-source")?.data.features,
      ).toHaveLength(0),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await user.click(toggle);

    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(screen.queryByText("Active")).not.toBeInTheDocument();
    await waitFor(() =>
      expect(
        map.getSource("filter-owned-regions-source")?.data.features,
      ).toHaveLength(1),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("shows and hides a heatmap without reloading its data", async () => {
    const resolveRequests: Array<(response: Response) => void> = [];
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveRequests.push(resolve);
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<MapWorkspace />);

    await screen.findByText("Centered near you");
    await drawArea(user);
    await addContribution(user, "Heatmap", "nearby-parks/influence");

    const toggle = screen.getByRole("switch", {
      name: "Parks visible",
    });
    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("Loading")).toBeInTheDocument();
    expect(screen.queryByText("Active")).not.toBeInTheDocument();

    await user.click(toggle);

    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText("Loading")).toBeInTheDocument();
    expect(screen.queryByText("Off")).not.toBeInTheDocument();
    expect(screen.queryByTestId("map-active-summary")).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      for (const resolve of resolveRequests.splice(0)) {
        resolve(Response.json({ tiles: [], parks: [] }));
      }
    });
    await waitFor(() =>
      expect(screen.queryByText("Loading")).not.toBeInTheDocument(),
    );
    expect(screen.queryByText("Active")).not.toBeInTheDocument();

    await user.click(toggle);

    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(screen.getByTestId("map-active-summary")).toHaveTextContent(
      "Parks",
    );
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
                center: [-0.11, 51.512],
                bbox: {
                  west: -0.2,
                  south: 51.4,
                  east: 0,
                  north: 51.6,
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
              center: [-0.105, 51.512],
              bbox: {
                west: -0.15,
                south: 51.45,
                east: -0.05,
                north: 51.55,
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
    await addContribution(user, "Filter", "nearby-parks/distance");
    await addContribution(user, "Filter", "nearby-water/distance");

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
    await addContribution(user, "Heatmap", "nearby-parks/influence");
    await addContribution(user, "Heatmap", "nearby-parks/influence");

    await waitFor(() =>
      expect(
        screen.getAllByRole("button", {
          name: "Remove Parks heatmap",
        }),
      ).toHaveLength(2),
    );

    await user.click(
      screen.getAllByRole("button", {
        name: "Remove Parks heatmap",
      })[0],
    );
    expect(
      screen.getAllByRole("button", {
        name: "Remove Parks heatmap",
      }),
    ).toHaveLength(1);
  });

  it("clips point heatmaps only to the Area of Interest", async () => {
    const filterCount = extensionRegistry.filters.length;
    const heatmapCount = extensionRegistry.heatmaps.length;
    const testExtension = {
      apiVersion: 1 as const,
      id: "test",
      name: "Test contributions",
    };
    extensionRegistry.filters.push({
      key: "test/reject-all",
      extension: testExtension,
      contribution: {
        id: "reject-all",
        name: "Reject all",
        initialState: {},
        Controls: () => null,
        resolvePredicate: async () => () => false,
      },
    });
    extensionRegistry.heatmaps.push({
      key: "test/points",
      extension: testExtension,
      contribution: {
        kind: "points",
        id: "points",
        name: "Test points",
        initialState: {},
        load: async () => ({
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              id: "inside",
              geometry: { type: "Point", coordinates: [-0.1, 51.512] },
              properties: {},
            },
            {
              type: "Feature",
              id: "outside",
              geometry: { type: "Point", coordinates: [1, 52] },
              properties: {},
            },
          ],
        }),
        style: {},
      },
    });

    try {
      const user = userEvent.setup();
      render(<MapWorkspace />);
      await screen.findByText("Centered near you");
      const map = (
        MapLibreMap as unknown as {
          lastInstance: {
            getSource(id: string): { data: FeatureCollection } | undefined;
            setCenter(center: [number, number]): void;
          };
        }
      ).lastInstance;
      map.setCenter([0, 0]);

      await drawArea(user);
      await addContribution(user, "Filter", "test/reject-all");
      await addContribution(user, "Heatmap", "test/points");

      await waitFor(() =>
        expect(
          map
            .getSource("extension-source-heatmap-2")
            ?.data.features.map((feature) => feature.id),
        ).toEqual(["inside"]),
      );
    } finally {
      extensionRegistry.filters.splice(filterCount);
      extensionRegistry.heatmaps.splice(heatmapCount);
    }
  });

  it("looks up a commute address and draws the selected red filter outline", async () => {
    const polygon = [
      [-0.3, 51.4],
      [0.05, 51.4],
      [0.05, 51.65],
      [-0.3, 51.65],
      [-0.3, 51.4],
    ];
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, _init?: RequestInit) => {
        if (String(input).startsWith("/api/address-suggestions")) {
          return Response.json({
            suggestions: [
              {
                label: "1 Peachtree St, Atlanta, GA",
                address: "1 Peachtree St, Atlanta, GA",
                center: [-0.115, 51.512],
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
    await addContribution(user, "Filter", "commute/time");
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
      -0.115,
      2,
    );
    expect(Number(suggestionParameters.get("latitude"))).toBeCloseTo(
      51.512,
      2,
    );
    await user.click(
      await screen.findByRole(
        "button",
        { name: "1 Peachtree St, Atlanta, GA" },
        { timeout: 2_000 },
      ),
    );

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([input]) => String(input) === "/api/commute/isochrones",
        ),
      ).toBe(true),
    );
    expect(screen.queryByText("Active")).not.toBeInTheDocument();
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
    await addContribution(user, "Heatmap", "commute/travel-time");

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
    expect(options.zoom).toBe(10);
    expect(
      screen.getByText("Centered at your last known location"),
    ).toBeInTheDocument();

    await screen.findByText("Centered near you");
    const map = (
      MapLibreMap as unknown as {
        lastInstance: {
          jumpTo: ReturnType<typeof vi.fn>;
          getZoom(): number;
          setPadding: ReturnType<typeof vi.fn>;
        };
      }
    ).lastInstance;
    expect(map.jumpTo).toHaveBeenCalledWith({
      center: [-0.115, 51.512],
      zoom: 10,
    });
    expect(map.getZoom()).toBe(10);
    expect(map.setPadding).toHaveBeenCalledWith({
      top: 0,
      right: 0,
      bottom: 0,
      left: 400,
    });
    expect(
      JSON.parse(
        localStorage.getItem("places-heatmap:last-location") ?? "null",
      ),
    ).toEqual({ longitude: -0.115, latitude: 51.512 });
  });

  it("does not recenter when geolocation matches the saved location", async () => {
    localStorage.setItem(
      "places-heatmap:last-location",
      JSON.stringify({ longitude: -0.115, latitude: 51.512 }),
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
    expect(map.getZoom()).toBe(10);
  });
});
