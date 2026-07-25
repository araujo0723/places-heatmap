import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import * as maplibregl from "maplibre-gl";
import type {
  GeoJSONSource,
  HeatmapLayerSpecification,
  Map as MapLibreMap,
  StyleSpecification,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  TerraDraw,
  TerraDrawFreehandMode,
  TerraDrawSelectMode,
  type GeoJSONStoreFeatures,
} from "terra-draw";
import { TerraDrawMapLibreGLAdapter } from "terra-draw-maplibre-gl-adapter";
import type { Feature, FeatureCollection, Point, Polygon } from "geojson";
import {
  composePoints,
  normalizeHeatmapFeatures,
} from "../core/composition";
import type {
  HostedPoint,
  MapViewport,
  PointPredicate,
} from "../extensions/api";
import {
  extensionRegistry,
  type RegisteredFilter,
  type RegisteredHeatmap,
} from "../extensions/registry";

type RuntimeStatus = "loading" | "ready" | "error";

interface ActiveFilter {
  instanceId: string;
  entry: RegisteredFilter;
  state: unknown;
  revision: number;
  randomSeed: number;
  regionIds: Array<string | number>;
}

interface ActiveHeatmap {
  instanceId: string;
  entry: RegisteredHeatmap;
  state: unknown;
  revision: number;
  randomSeed: number;
}

interface FilterRuntime {
  status: RuntimeStatus;
  predicate?: PointPredicate;
  error?: string;
}

interface HeatmapRuntime {
  status: RuntimeStatus;
  points?: HostedPoint[];
  error?: string;
}

interface DrawPoint {
  x: number;
  y: number;
  coordinate: [number, number];
}

const DEFAULT_TILE_URL =
  "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const DEFAULT_ATTRIBUTION = "© OpenStreetMap contributors";
const LAST_LOCATION_KEY = "places-heatmap:last-location";
const EMPTY_COLLECTION: FeatureCollection<Point> = {
  type: "FeatureCollection",
  features: [],
};

function readLastLocation(): [number, number] | undefined {
  try {
    const value = JSON.parse(localStorage.getItem(LAST_LOCATION_KEY) ?? "null");
    if (
      value &&
      typeof value.longitude === "number" &&
      Number.isFinite(value.longitude) &&
      value.longitude >= -180 &&
      value.longitude <= 180 &&
      typeof value.latitude === "number" &&
      Number.isFinite(value.latitude) &&
      value.latitude >= -90 &&
      value.latitude <= 90
    ) {
      return [value.longitude, value.latitude];
    }
  } catch {
    // Ignore inaccessible or malformed browser storage.
  }
}

function saveLastLocation(longitude: number, latitude: number) {
  try {
    localStorage.setItem(
      LAST_LOCATION_KEY,
      JSON.stringify({ longitude, latitude }),
    );
  } catch {
    // Location still works when browser storage is unavailable.
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "An unknown error occurred.";
}

function safeMapId(key: string) {
  return key.replace(/[^a-zA-Z0-9_-]/g, "-");
}

function baseStyle(tileUrl: string, attribution: string): StyleSpecification {
  return {
    version: 8,
    sources: {
      openstreetmap: {
        type: "raster",
        tiles: [tileUrl],
        tileSize: 256,
        maxzoom: 19,
        attribution,
      },
    },
    layers: [
      {
        id: "openstreetmap",
        type: "raster",
        source: "openstreetmap",
      },
    ],
  };
}

function colorExpression(
  ramp: ReadonlyArray<readonly [number, string]> | undefined,
): HeatmapLayerSpecification["paint"] extends infer Paint
  ? Paint extends { "heatmap-color"?: infer Color }
    ? Color
    : never
  : never {
  const colors =
    ramp && ramp.length >= 2
      ? ramp
      : [
          [0, "rgba(67, 56, 202, 0)"],
          [0.3, "#4338ca"],
          [0.55, "#0891b2"],
          [0.8, "#facc15"],
          [1, "#f97316"],
        ];

  return [
    "interpolate",
    ["linear"],
    ["heatmap-density"],
    ...colors.flatMap(([stop, color]) => [stop, color]),
  ] as never;
}

function SectionHeading({
  title,
  count,
  children,
  countTestId,
}: {
  title: string;
  count: number;
  children?: ReactNode;
  countTestId?: string;
}) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <h2 className="text-xs font-bold tracking-[0.16em] text-slate-500 uppercase">
          {title}
        </h2>
        <span
          className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500"
          data-testid={countTestId}
        >
          {count}
        </span>
      </div>
      {children}
    </div>
  );
}

function Status({
  runtime,
  onRetry,
}: {
  runtime?: FilterRuntime | HeatmapRuntime;
  onRetry: () => void;
}) {
  if (!runtime) return null;

  if (runtime.status === "loading") {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-indigo-600">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-indigo-500" />
        Loading
      </span>
    );
  }

  if (runtime.status === "error") {
    const hasStaleValue =
      ("predicate" in runtime && !!runtime.predicate) ||
      ("points" in runtime && !!runtime.points);

    return (
      <div className="flex items-center gap-2">
        <span
          className="max-w-36 truncate text-[11px] font-medium text-rose-600"
          title={runtime.error}
        >
          {hasStaleValue ? "Stale" : "Error"}
        </span>
        <button
          className="rounded-md bg-rose-50 px-2 py-1 text-[11px] font-semibold text-rose-700 hover:bg-rose-100 focus:ring-2 focus:ring-rose-400 focus:outline-none"
          type="button"
          onClick={onRetry}
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-emerald-700">
      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
      Active
    </span>
  );
}

function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-200 px-4 py-5 text-center text-xs leading-5 text-slate-400">
      {children}
    </div>
  );
}

function AddContribution({
  label,
  options,
  onAdd,
  disabled = false,
}: {
  label: string;
  options: Array<{ key: string; label: string }>;
  onAdd: (key: string) => void;
  disabled?: boolean;
}) {
  return (
    <div>
      <label className="sr-only" htmlFor={`add-${label}`}>
        {label}
      </label>
      <select
        id={`add-${label}`}
        aria-label={label}
        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 shadow-sm focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 focus:outline-none disabled:bg-slate-50 disabled:text-slate-400"
        value=""
        disabled={disabled || options.length === 0}
        onChange={(event) => {
          const key = event.currentTarget.value;
          if (key) onAdd(key);
        }}
      >
        <option value="">
          {options.length ? `Add ${label.toLowerCase()}…` : "Nothing available"}
        </option>
        {options.map((option) => (
          <option key={option.key} value={option.key}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export default function MapWorkspace() {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const drawRef = useRef<TerraDraw | null>(null);
  const activeDrawPointerRef = useRef<number | undefined>(undefined);
  const drawDraftRef = useRef<DrawPoint[]>([]);
  const renderedLayerKeysRef = useRef(new Set<string>());
  const contributionInstanceRef = useRef(0);
  const lastLocationRef = useRef(readLastLocation());

  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState<string>();
  const [drawError, setDrawError] = useState<string>();
  const [drawDraft, setDrawDraft] = useState<DrawPoint[]>([]);
  const [locationStatus, setLocationStatus] = useState<
    "cached" | "locating" | "located" | "unavailable"
  >(lastLocationRef.current ? "cached" : "locating");
  const [drawMode, setDrawMode] = useState<"select" | "freehand">("select");
  const [regions, setRegions] = useState<Array<Feature<Polygon>>>([]);
  const [selectedRegionIds, setSelectedRegionIds] = useState<
    Array<string | number>
  >([]);
  const [activeFilters, setActiveFilters] = useState<ActiveFilter[]>([]);
  const [activeHeatmaps, setActiveHeatmaps] = useState<ActiveHeatmap[]>([]);
  const [filterRuntime, setFilterRuntime] = useState<
    Record<string, FilterRuntime>
  >({});
  const [heatmapRuntime, setHeatmapRuntime] = useState<
    Record<string, HeatmapRuntime>
  >({});

  const currentViewport = (): MapViewport => {
    const map = mapRef.current;
    const fallbackCenter = lastLocationRef.current ?? [-0.115, 51.512];
    if (!map) {
      return {
        center: fallbackCenter,
        bounds: {
          west: fallbackCenter[0] - 0.06,
          south: fallbackCenter[1] - 0.04,
          east: fallbackCenter[0] + 0.06,
          north: fallbackCenter[1] + 0.04,
        },
      };
    }

    const center = map.getCenter();
    const bounds = map.getBounds();
    return {
      center: [center.lng, center.lat],
      bounds: {
        west: bounds.getWest(),
        south: bounds.getSouth(),
        east: bounds.getEast(),
        north: bounds.getNorth(),
      },
    };
  };

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    try {
      const lastLocation = lastLocationRef.current;
      const tileUrl =
        import.meta.env.PUBLIC_BASEMAP_TILE_URL || DEFAULT_TILE_URL;
      const attribution =
        import.meta.env.PUBLIC_BASEMAP_ATTRIBUTION || DEFAULT_ATTRIBUTION;
      const map = new maplibregl.Map({
        container: mapContainerRef.current,
        style: baseStyle(tileUrl, attribution),
        center: lastLocation ?? [-0.115, 51.512],
        zoom: 12.3,
        attributionControl: false,
      });
      mapRef.current = map;
      map.addControl(
        new maplibregl.NavigationControl({ showCompass: false }),
        "top-right",
      );
      map.addControl(
        new maplibregl.AttributionControl({ compact: false }),
        "bottom-right",
      );
      const geolocate = new maplibregl.GeolocateControl({
        positionOptions: {
          enableHighAccuracy: true,
          timeout: 10_000,
          maximumAge: 60_000,
        },
        fitBoundsOptions: {
          maxZoom: 12,
          duration: 0,
          padding: { top: 80, right: 80, bottom: 80, left: 420 },
        },
        trackUserLocation: false,
        showUserLocation: true,
        showAccuracyCircle: true,
      });
      geolocate.on("geolocate", (event) => {
        const position = event as unknown as Partial<GeolocationPosition>;
        if (
          typeof position.coords?.longitude === "number" &&
          typeof position.coords.latitude === "number"
        ) {
          saveLastLocation(
            position.coords.longitude,
            position.coords.latitude,
          );
        }
        setLocationStatus("located");
      });
      geolocate.on("error", () => setLocationStatus("unavailable"));
      map.addControl(geolocate, "top-right");

      const onLoad = () => {
        const draw = new TerraDraw({
          adapter: new TerraDrawMapLibreGLAdapter({
            map,
            prefixId: "regions",
          }),
          modes: [
            new TerraDrawFreehandMode({
              drawInteraction: "click-drag",
              minDistance: 8,
              smoothing: 0.15,
            }),
            new TerraDrawSelectMode({
              flags: {
                freehand: {
                  feature: {
                    draggable: true,
                    coordinates: {
                      draggable: true,
                      deletable: true,
                      midpoints: true,
                    },
                  },
                },
              },
            }),
          ],
        });

        const syncRegions = () => {
          const polygons = draw
            .getSnapshot()
            .filter(
              (
                feature,
              ): feature is GeoJSONStoreFeatures<Polygon> =>
                feature.geometry.type === "Polygon",
            )
            .map((feature) => feature as Feature<Polygon>);
          setRegions(polygons);
        };
        const finishDrawing = () => {
          syncRegions();
          draw.setMode("select");
          setDrawMode("select");
        };
        const selectRegion = (id: string | number) => {
          setSelectedRegionIds((current) =>
            current.includes(id) ? current : [...current, id],
          );
        };
        const deselectRegion = (id: string | number) => {
          setSelectedRegionIds((current) =>
            current.filter((candidate) => candidate !== id),
          );
        };

        draw.on("change", syncRegions);
        draw.on("finish", finishDrawing);
        draw.on("select", selectRegion);
        draw.on("deselect", deselectRegion);
        draw.start();
        draw.setMode("select");

        drawRef.current = draw;
        setMapReady(true);
        if (!lastLocation) setLocationStatus("locating");
        geolocate.trigger();
      };

      const onError = (event: maplibregl.ErrorEvent) => {
        if (!map.loaded()) setMapError(event.error?.message ?? "Map failed to load.");
      };

      map.on("load", onLoad);
      map.on("error", onError);

      return () => {
        drawRef.current?.stop();
        drawRef.current = null;
        map.remove();
        mapRef.current = null;
      };
    } catch (error) {
      setMapError(errorMessage(error));
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const activeKeys = new Set(
      activeFilters.map(({ instanceId }) => instanceId),
    );

    setFilterRuntime((current) =>
      Object.fromEntries(
        activeFilters.map(({ instanceId }) => [
          instanceId,
          {
            ...current[instanceId],
            status: "loading" as const,
            error: undefined,
          },
        ]),
      ),
    );

    for (const selection of activeFilters) {
      Promise.resolve(
        selection.entry.contribution.resolvePredicate(selection.state, {
          signal: controller.signal,
          viewport: currentViewport(),
          randomSeed: selection.randomSeed,
        }),
      )
        .then((predicate) => {
          if (
            controller.signal.aborted ||
            !activeKeys.has(selection.instanceId)
          )
            return;
          if (typeof predicate !== "function") {
            throw new Error("Filter did not return a predicate.");
          }
          setFilterRuntime((current) => ({
            ...current,
            [selection.instanceId]: { status: "ready", predicate },
          }));
        })
        .catch((error) => {
          if (controller.signal.aborted) return;
          setFilterRuntime((current) => ({
            ...current,
            [selection.instanceId]: {
              ...current[selection.instanceId],
              status: "error",
              error: errorMessage(error),
            },
          }));
        });
    }

    return () => controller.abort();
  }, [activeFilters]);

  useEffect(() => {
    const controller = new AbortController();
    const activeKeys = new Set(
      activeHeatmaps.map(({ instanceId }) => instanceId),
    );

    setHeatmapRuntime((current) =>
      Object.fromEntries(
        activeHeatmaps.map(({ instanceId }) => [
          instanceId,
          {
            ...current[instanceId],
            status: "loading" as const,
            error: undefined,
          },
        ]),
      ),
    );

    for (const selection of activeHeatmaps) {
      selection.entry.contribution
        .load(selection.state, {
          signal: controller.signal,
          viewport: currentViewport(),
          randomSeed: selection.randomSeed,
        })
        .then((collection) =>
          normalizeHeatmapFeatures(
            collection,
            {
              extensionId: selection.entry.extension.id,
              contributionId: selection.entry.contribution.id,
            },
            selection.entry.contribution.style,
          ),
        )
        .then((points) => {
          if (
            controller.signal.aborted ||
            !activeKeys.has(selection.instanceId)
          )
            return;
          setHeatmapRuntime((current) => ({
            ...current,
            [selection.instanceId]: { status: "ready", points },
          }));
        })
        .catch((error) => {
          if (controller.signal.aborted) return;
          setHeatmapRuntime((current) => ({
            ...current,
            [selection.instanceId]: {
              ...current[selection.instanceId],
              status: "error",
              error: errorMessage(error),
            },
          }));
        });
    }

    return () => controller.abort();
  }, [activeHeatmaps]);

  const predicates = useMemo(
    () =>
      activeFilters
        .map(({ instanceId }) => filterRuntime[instanceId]?.predicate)
        .filter((predicate): predicate is PointPredicate => !!predicate),
    [activeFilters, filterRuntime],
  );

  const filtersBlocked = activeFilters.some(
    ({ instanceId }) => !filterRuntime[instanceId]?.predicate,
  );

  const groupedPoints = useMemo(() => {
    const groups = new Map<string, FeatureCollection<Point>>();
    for (const { instanceId } of activeHeatmaps) {
      const points = heatmapRuntime[instanceId]?.points ?? [];
      groups.set(instanceId, {
        type: "FeatureCollection",
        features: filtersBlocked
          ? []
          : composePoints(points, predicates, regions).map(
              ({ feature }) => feature,
            ),
      });
    }
    return groups;
  }, [
    activeHeatmaps,
    filtersBlocked,
    heatmapRuntime,
    predicates,
    regions,
  ]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !map.isStyleLoaded()) return;

    const desiredKeys = new Set(
      activeHeatmaps.map(({ instanceId }) => instanceId),
    );
    for (const key of renderedLayerKeysRef.current) {
      if (desiredKeys.has(key)) continue;
      const safeKey = safeMapId(key);
      const layerId = `extension-heatmap-${safeKey}`;
      const pointLayerId = `extension-points-${safeKey}`;
      const sourceId = `extension-source-${safeKey}`;
      if (map.getLayer(pointLayerId)) map.removeLayer(pointLayerId);
      if (map.getLayer(layerId)) map.removeLayer(layerId);
      if (map.getSource(sourceId)) map.removeSource(sourceId);
      renderedLayerKeysRef.current.delete(key);
    }

    for (const { entry, instanceId } of activeHeatmaps) {
      const safeKey = safeMapId(instanceId);
      const layerId = `extension-heatmap-${safeKey}`;
      const sourceId = `extension-source-${safeKey}`;
      const data = groupedPoints.get(instanceId) ?? EMPTY_COLLECTION;
      const existingSource = map.getSource(sourceId) as GeoJSONSource | undefined;

      if (existingSource) {
        existingSource.setData(data);
      } else {
        map.addSource(sourceId, { type: "geojson", data });
      }

      if (!map.getLayer(layerId)) {
        const style = entry.contribution.style;
        const layer: HeatmapLayerSpecification = {
          id: layerId,
          source: sourceId,
          type: "heatmap",
          paint: {
            "heatmap-weight": ["get", "weight"],
            "heatmap-radius": style.radius ?? 30,
            "heatmap-intensity": style.intensity ?? 1,
            "heatmap-opacity": style.opacity ?? 0.8,
            "heatmap-color": colorExpression(style.colorRamp),
          },
        };
        const beforeId = map.getLayer("regions-polygon")
          ? "regions-polygon"
          : undefined;
        map.addLayer(layer, beforeId);
      }
      const pointLayerId = `extension-points-${safeKey}`;
      if (!map.getLayer(pointLayerId)) {
        const beforeId = map.getLayer("regions-polygon")
          ? "regions-polygon"
          : undefined;
        map.addLayer(
          {
            id: pointLayerId,
            source: sourceId,
            type: "circle",
            paint: {
              "circle-radius": [
                "interpolate",
                ["linear"],
                ["get", "weight"],
                1,
                2.5,
                10,
                5,
              ],
              "circle-color": "#312e81",
              "circle-opacity": 0.72,
              "circle-stroke-color": "#ffffff",
              "circle-stroke-width": 1,
              "circle-stroke-opacity": 0.9,
            },
          },
          beforeId,
        );
      }

      renderedLayerKeysRef.current.add(instanceId);
    }
  }, [activeHeatmaps, groupedPoints, mapReady]);

  const randomRegions = (seed: number) => {
    const draw = drawRef.current;
    if (!draw) return [];

    let value = seed >>> 0;
    const random = () => {
      value += 0x6d2b79f5;
      let result = value;
      result = Math.imul(result ^ (result >>> 15), result | 1);
      result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
      return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
    };
    const viewport = currentViewport();
    const { west, south, east, north } = viewport.bounds;
    const longitudeSpan = Math.max(east - west, 0.01);
    const latitudeSpan = Math.max(north - south, 0.01);
    const features = Array.from({ length: 3 }, (_, regionIndex) => {
      const centerLongitude =
        viewport.center[0] + (random() - 0.5) * longitudeSpan * 0.5;
      const centerLatitude =
        viewport.center[1] + (random() - 0.5) * latitudeSpan * 0.5;
      const vertexCount = 7 + Math.floor(random() * 4);
      const coordinates = Array.from({ length: vertexCount }, (_, index) => {
        const angle = (index / vertexCount) * Math.PI * 2;
        const radius = 0.12 + random() * 0.1;
        const longitude = Math.min(
          east,
          Math.max(
            west,
            centerLongitude + Math.cos(angle) * longitudeSpan * radius,
          ),
        );
        const latitude = Math.min(
          north,
          Math.max(
            south,
            centerLatitude + Math.sin(angle) * latitudeSpan * radius,
          ),
        );
        return [
          Number(longitude.toFixed(6)),
          Number(latitude.toFixed(6)),
        ] as [number, number];
      });
      coordinates.push(coordinates[0]);
      return {
        type: "Feature" as const,
        id: draw.getFeatureId(),
        properties: {
          mode: "freehand",
          generated: true,
          regionIndex,
        },
        geometry: {
          type: "Polygon" as const,
          coordinates: [coordinates],
        },
      };
    });
    const validations = draw.addFeatures(features);
    const validIds = features
      .filter((_, index) => validations[index]?.valid)
      .map(({ id }) => id as string | number);
    setRegions(
      draw
        .getSnapshot()
        .filter((feature) => feature.geometry.type === "Polygon")
        .map((feature) => feature as Feature<Polygon>),
    );
    return validIds;
  };

  const addFilter = (key: string) => {
    const entry = extensionRegistry.filters.find(
      (candidate) => candidate.key === key,
    );
    if (!entry) return;
    contributionInstanceRef.current += 1;
    const randomSeed = Math.floor(Math.random() * 2_147_483_647);
    const regionIds = randomRegions(randomSeed);
    setActiveFilters((current) => [
      ...current,
      {
        instanceId: `filter-${contributionInstanceRef.current}`,
        entry,
        state: entry.contribution.initialState,
        revision: 0,
        randomSeed,
        regionIds,
      },
    ]);
  };

  const addHeatmap = (key: string) => {
    const entry = extensionRegistry.heatmaps.find(
      (candidate) => candidate.key === key,
    );
    if (!entry) return;
    contributionInstanceRef.current += 1;
    const randomSeed = Math.floor(Math.random() * 2_147_483_647);
    setActiveHeatmaps((current) => [
      ...current,
      {
        instanceId: `heatmap-${contributionInstanceRef.current}`,
        entry,
        state: entry.contribution.initialState,
        revision: 0,
        randomSeed,
      },
    ]);
  };

  const startDrawing = () => {
    const map = mapRef.current;
    map?.stop();
    drawRef.current?.setMode("select");
    activeDrawPointerRef.current = undefined;
    drawDraftRef.current = [];
    setDrawDraft([]);
    setDrawError(undefined);
    setSelectedRegionIds([]);
    setDrawMode("freehand");
  };
  const startEditing = () => {
    drawRef.current?.setMode("select");
    activeDrawPointerRef.current = undefined;
    drawDraftRef.current = [];
    setDrawDraft([]);
    setDrawError(undefined);
    setDrawMode("select");
  };
  const drawPointFromEvent = (
    event: ReactPointerEvent<HTMLDivElement>,
  ): DrawPoint | undefined => {
    const map = mapRef.current;
    if (!map) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - bounds.left;
    const y = event.clientY - bounds.top;
    const location = map.unproject([x, y]);
    return {
      x,
      y,
      coordinate: [
        Number(location.lng.toFixed(6)),
        Number(location.lat.toFixed(6)),
      ],
    };
  };
  const updateDrawDraft = (points: DrawPoint[]) => {
    drawDraftRef.current = points;
    setDrawDraft(points);
  };
  const onDrawPointerDown = (
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    if (
      drawMode !== "freehand" ||
      !event.isPrimary ||
      event.button !== 0
    ) {
      return;
    }
    const point = drawPointFromEvent(event);
    if (!point) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    activeDrawPointerRef.current = event.pointerId;
    setDrawError(undefined);
    updateDrawDraft([point]);
  };
  const onDrawPointerMove = (
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    if (activeDrawPointerRef.current !== event.pointerId) return;
    const point = drawPointFromEvent(event);
    const previous = drawDraftRef.current.at(-1);
    if (
      !point ||
      (previous && Math.hypot(point.x - previous.x, point.y - previous.y) < 4)
    ) {
      return;
    }
    event.preventDefault();
    updateDrawDraft([...drawDraftRef.current, point]);
  };
  const onDrawPointerUp = (
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    if (activeDrawPointerRef.current !== event.pointerId) return;
    event.preventDefault();
    event.currentTarget.releasePointerCapture(event.pointerId);
    activeDrawPointerRef.current = undefined;

    const finalPoint = drawPointFromEvent(event);
    const previous = drawDraftRef.current.at(-1);
    const points =
      finalPoint &&
      (!previous ||
        Math.hypot(finalPoint.x - previous.x, finalPoint.y - previous.y) >= 4)
        ? [...drawDraftRef.current, finalPoint]
        : drawDraftRef.current;

    if (points.length < 3) {
      updateDrawDraft([]);
      setDrawError("Trace a larger region before releasing the pointer.");
      return;
    }

    const coordinates = points.map(({ coordinate }) => coordinate);
    const first = coordinates[0];
    const last = coordinates.at(-1);
    const closedCoordinates =
      last && last[0] === first[0] && last[1] === first[1]
        ? coordinates
        : [...coordinates, first];
    const draw = drawRef.current;
    if (!draw) return;
    const feature: GeoJSONStoreFeatures<Polygon> = {
      type: "Feature",
      id: draw.getFeatureId(),
      properties: { mode: "freehand" },
      geometry: {
        type: "Polygon",
        coordinates: [closedCoordinates],
      },
    };
    const [validation] = draw.addFeatures([feature]);

    if (!validation?.valid) {
      updateDrawDraft([]);
      setDrawError(validation?.reason ?? "The drawn region was invalid.");
      return;
    }

    updateDrawDraft([]);
    setRegions(
      draw
        .getSnapshot()
        .filter((candidate) => candidate.geometry.type === "Polygon")
        .map((candidate) => candidate as Feature<Polygon>),
    );
    draw.setMode("select");
    setDrawMode("select");
  };
  const onDrawPointerCancel = (
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    if (activeDrawPointerRef.current !== event.pointerId) return;
    activeDrawPointerRef.current = undefined;
    updateDrawDraft([]);
    setDrawError("Drawing was interrupted. Try tracing the region again.");
  };
  const drawPreviewPath =
    drawDraft.length > 1
      ? `${drawDraft
          .map(
            ({ x, y }, index) =>
              `${index === 0 ? "M" : "L"} ${x} ${y}`,
          )
          .join(" ")} Z`
      : undefined;
  const deleteSelectedRegions = () => {
    if (!drawRef.current || selectedRegionIds.length === 0) return;
    drawRef.current.removeFeatures(selectedRegionIds);
    setSelectedRegionIds([]);
    setRegions(
      drawRef.current
        .getSnapshot()
        .filter((feature) => feature.geometry.type === "Polygon")
        .map((feature) => feature as Feature<Polygon>),
    );
  };
  const clearRegions = () => {
    drawRef.current?.clear();
    setRegions([]);
    setSelectedRegionIds([]);
  };

  return (
    <main className="relative h-screen min-h-[640px] min-w-[1024px] overflow-hidden bg-slate-200 text-slate-900">
      <div
        ref={mapContainerRef}
        data-testid="map"
        className="!absolute !inset-0"
        aria-label="Interactive places map"
      />
      {drawMode === "freehand" ? (
        <div
          data-testid="draw-overlay"
          className="absolute inset-0 z-[5] cursor-crosshair touch-none"
          onPointerDown={onDrawPointerDown}
          onPointerMove={onDrawPointerMove}
          onPointerUp={onDrawPointerUp}
          onPointerCancel={onDrawPointerCancel}
        >
          <svg
            className="pointer-events-none h-full w-full"
            aria-hidden="true"
          >
            {drawPreviewPath ? (
              <path
                data-testid="draw-preview"
                d={drawPreviewPath}
                fill="rgba(79, 70, 229, 0.20)"
                stroke="rgba(67, 56, 202, 0.95)"
                strokeWidth="3"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            ) : null}
          </svg>
        </div>
      ) : null}

      <aside className="absolute top-4 bottom-4 left-4 z-10 flex w-96 flex-col overflow-hidden rounded-2xl border border-white/70 bg-white/95 shadow-2xl shadow-slate-900/20 backdrop-blur">
        <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5">
          <section className="space-y-3" aria-labelledby="regions-heading">
            <SectionHeading
              title="Regions"
              count={regions.length}
              countTestId="region-count"
            />
            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
              <div className="grid grid-cols-2 gap-2">
                <button
                  className={`rounded-lg px-3 py-2 text-xs font-semibold focus:ring-2 focus:ring-indigo-300 focus:outline-none ${
                    drawMode === "freehand"
                      ? "bg-indigo-600 text-white shadow-sm"
                      : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                  }`}
                  type="button"
                  disabled={!mapReady}
                  aria-pressed={drawMode === "freehand"}
                  onClick={startDrawing}
                >
                  Draw region
                </button>
                <button
                  className={`rounded-lg px-3 py-2 text-xs font-semibold focus:ring-2 focus:ring-indigo-300 focus:outline-none ${
                    drawMode === "select"
                      ? "bg-indigo-600 text-white shadow-sm"
                      : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                  }`}
                  type="button"
                  disabled={!mapReady}
                  aria-pressed={drawMode === "select"}
                  onClick={startEditing}
                >
                  Select & edit
                </button>
                <button
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 focus:ring-2 focus:ring-slate-300 focus:outline-none disabled:cursor-not-allowed disabled:opacity-40"
                  type="button"
                  disabled={selectedRegionIds.length === 0}
                  onClick={deleteSelectedRegions}
                >
                  Delete selected
                </button>
                <button
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 focus:ring-2 focus:ring-slate-300 focus:outline-none disabled:cursor-not-allowed disabled:opacity-40"
                  type="button"
                  disabled={regions.length === 0}
                  onClick={clearRegions}
                >
                  Clear all
                </button>
              </div>
              {drawMode === "freehand" ? (
                <p className="mt-3 text-[11px] leading-4 text-slate-500">
                  Press and drag on the map to trace a region. Map panning is
                  paused.
                </p>
              ) : null}
            </div>
          </section>

          <section className="space-y-3" aria-labelledby="filters-heading">
            <SectionHeading title="Filters" count={activeFilters.length} />
            <AddContribution
              label="Filter"
              options={extensionRegistry.filters.map((entry) => ({
                key: entry.key,
                label: `${entry.extension.name} · ${entry.contribution.name}`,
              }))}
              onAdd={addFilter}
              disabled={!mapReady}
            />
            {activeFilters.length === 0 ? (
              <EmptyState>No active filters</EmptyState>
            ) : (
              <div className="space-y-2">
                {activeFilters.map((selection) => {
                  const runtime = filterRuntime[selection.instanceId];
                  const Controls = selection.entry.contribution.Controls;
                  return (
                    <article
                      key={selection.instanceId}
                      className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-xs font-semibold text-slate-900">
                            {selection.entry.contribution.name}
                          </p>
                          <p className="mt-0.5 truncate text-[11px] text-slate-400">
                            {selection.entry.extension.name}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Status
                            runtime={runtime}
                            onRetry={() =>
                              setActiveFilters((current) =>
                                current.map((item) =>
                                  item.instanceId === selection.instanceId
                                    ? { ...item, revision: item.revision + 1 }
                                    : item,
                                ),
                              )
                            }
                          />
                          <button
                            aria-label={`Remove ${selection.entry.contribution.name}`}
                            className="rounded-md px-1.5 py-0.5 text-lg leading-none text-slate-300 hover:bg-slate-100 hover:text-slate-600 focus:ring-2 focus:ring-slate-300 focus:outline-none"
                            type="button"
                            onClick={() => {
                              const draw = drawRef.current;
                              const existingRegionIds =
                                selection.regionIds.filter((id) =>
                                  draw?.hasFeature(id),
                                );
                              if (existingRegionIds.length) {
                                draw?.removeFeatures(existingRegionIds);
                              }
                              setRegions(
                                draw
                                  ?.getSnapshot()
                                  .filter(
                                    (feature) =>
                                      feature.geometry.type === "Polygon",
                                  )
                                  .map(
                                    (feature) =>
                                      feature as Feature<Polygon>,
                                  ) ?? [],
                              );
                              setActiveFilters((current) =>
                                current.filter(
                                  (item) =>
                                    item.instanceId !== selection.instanceId,
                                ),
                              );
                            }}
                          >
                            ×
                          </button>
                        </div>
                      </div>
                      <div className="mt-3 border-t border-slate-100 pt-3">
                        <Controls
                          value={selection.state}
                          disabled={false}
                          loading={runtime?.status === "loading"}
                          onChange={(state) =>
                            setActiveFilters((current) =>
                              current.map((item) =>
                                item.instanceId === selection.instanceId
                                  ? { ...item, state }
                                  : item,
                              ),
                            )
                          }
                        />
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>

          <section className="space-y-3" aria-labelledby="heatmaps-heading">
            <SectionHeading title="Heatmaps" count={activeHeatmaps.length} />
            <AddContribution
              label="Heatmap"
              options={extensionRegistry.heatmaps.map((entry) => ({
                key: entry.key,
                label: `${entry.extension.name} · ${entry.contribution.name}`,
              }))}
              onAdd={addHeatmap}
              disabled={!mapReady}
            />
            {activeHeatmaps.length === 0 ? (
              <EmptyState>No active heatmaps</EmptyState>
            ) : (
              <div className="space-y-2">
                {activeHeatmaps.map((selection) => {
                  const runtime = heatmapRuntime[selection.instanceId];
                  const Controls = selection.entry.contribution.Controls;
                  return (
                    <article
                      key={selection.instanceId}
                      className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-xs font-semibold text-slate-900">
                            {selection.entry.contribution.name}
                          </p>
                          <p className="mt-0.5 truncate text-[11px] text-slate-400">
                            {selection.entry.extension.name}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Status
                            runtime={runtime}
                            onRetry={() =>
                              setActiveHeatmaps((current) =>
                                current.map((item) =>
                                  item.instanceId === selection.instanceId
                                    ? { ...item, revision: item.revision + 1 }
                                    : item,
                                ),
                              )
                            }
                          />
                          <button
                            aria-label={`Remove ${selection.entry.contribution.name}`}
                            className="rounded-md px-1.5 py-0.5 text-lg leading-none text-slate-300 hover:bg-slate-100 hover:text-slate-600 focus:ring-2 focus:ring-slate-300 focus:outline-none"
                            type="button"
                            onClick={() =>
                              setActiveHeatmaps((current) =>
                                current.filter(
                                  (item) =>
                                    item.instanceId !== selection.instanceId,
                                ),
                              )
                            }
                          >
                            ×
                          </button>
                        </div>
                      </div>
                      {Controls ? (
                        <div className="mt-3 border-t border-slate-100 pt-3">
                          <Controls
                            value={selection.state}
                            disabled={false}
                            loading={runtime?.status === "loading"}
                            onChange={(state) =>
                              setActiveHeatmaps((current) =>
                                current.map((item) =>
                                  item.instanceId === selection.instanceId
                                    ? { ...item, state }
                                    : item,
                                ),
                              )
                            }
                          />
                        </div>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            )}
          </section>

          {extensionRegistry.diagnostics.length ? (
            <section className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-3">
              <h2 className="text-xs font-semibold text-amber-900">
                Extension diagnostics
              </h2>
              <ul className="list-disc space-y-1 pl-4 text-[11px] leading-4 text-amber-800">
                {extensionRegistry.diagnostics.map((diagnostic) => (
                  <li key={diagnostic}>{diagnostic}</li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      </aside>

      <div
        className="absolute right-4 bottom-8 z-20 flex max-w-sm flex-col items-end gap-2"
        aria-live="polite"
      >
        {!mapReady ? (
          <div className="rounded-lg bg-slate-950 px-3 py-2 text-xs font-medium text-white shadow-lg shadow-slate-950/25">
            {mapError ? `Map failed: ${mapError}` : "Loading map…"}
          </div>
        ) : null}
        <div
          className="rounded-lg bg-slate-950 px-3 py-2 text-xs font-medium text-white shadow-lg shadow-slate-950/25"
          data-testid="location-status"
        >
          {locationStatus === "located"
            ? "Centered near you"
            : locationStatus === "cached"
              ? "Centered at your last known location"
              : locationStatus === "unavailable"
                ? "Location unavailable — use the target button to retry"
                : "Finding your location…"}
        </div>
        {mapError && mapReady ? (
          <div className="rounded-lg bg-slate-950 px-3 py-2 text-xs font-medium text-white shadow-lg shadow-slate-950/25">
            Base map warning: {mapError}
          </div>
        ) : null}
        {drawError ? (
          <div
            className="rounded-lg bg-slate-950 px-3 py-2 text-xs font-medium text-white shadow-lg shadow-slate-950/25"
            role="alert"
          >
            {drawError}
          </div>
        ) : null}
        {activeFilters.length || activeHeatmaps.length ? (
          <div
            className="flex flex-col items-end gap-2"
            data-testid="map-active-summary"
          >
            {activeFilters.length ? (
              <div className="rounded-lg bg-slate-950 px-3 py-2 text-xs font-medium text-white shadow-lg shadow-slate-950/25">
                {activeFilters.length} active{" "}
                {activeFilters.length === 1 ? "filter" : "filters"}
              </div>
            ) : null}
            {activeHeatmaps.map(({ entry, instanceId }) => (
              <div
                key={instanceId}
                className="inline-flex items-center gap-2 rounded-lg bg-slate-950 px-3 py-2 text-xs font-medium text-white shadow-lg shadow-slate-950/25"
              >
                <span className="h-2 w-2 rounded-full bg-indigo-400" />
                {entry.contribution.name}
                <span className="text-slate-400">
                  {groupedPoints.get(instanceId)?.features.length ?? 0}
                </span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </main>
  );
}
