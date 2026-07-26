import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import * as maplibregl from "maplibre-gl";
import type {
  GeoJSONSource,
  FillLayerSpecification,
  HeatmapLayerSpecification,
  Map as MapLibreMap,
  StyleSpecification,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Feature, FeatureCollection, Point, Polygon } from "geojson";
import {
  composePoints,
  normalizeHeatmapFeatures,
  normalizeSurfaceHeatmap,
} from "../core/composition";
import {
  clipSurfaceCollection,
  intersectRegionGroups,
  regionViewport,
} from "../core/regions";
import {
  searchAddresses,
  type AddressSelection,
} from "../extensions/commute/data";
import type {
  HostedPoint,
  MapViewport,
  PointPredicate,
  RegionFeature,
  RegionGeometry,
  SurfaceProperties,
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
  regions?: RegionFeature[];
  regionCount?: number;
  error?: string;
}

interface HeatmapRuntime {
  status: RuntimeStatus;
  points?: HostedPoint[];
  surface?: FeatureCollection<RegionGeometry, SurfaceProperties>;
  itemCount?: number;
  error?: string;
}

const DEFAULT_TILE_URL =
  "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const DEFAULT_ATTRIBUTION = "© OpenStreetMap contributors";
const LAST_LOCATION_KEY = "places-heatmap:last-location";
const INITIAL_ZOOM = 10;
const AREA_OF_INTEREST_RADIUS_MILES = 20;
const EARTH_RADIUS_MILES = 3_958.7613;
const MAP_PADDING = { top: 0, right: 0, bottom: 0, left: 400 } as const;
const SAME_LOCATION_THRESHOLD_METERS = 25;
const SNACK_DURATION_MS = 5_000;
const EMPTY_COLLECTION: FeatureCollection<Point> = {
  type: "FeatureCollection",
  features: [],
};
const EMPTY_SURFACE_COLLECTION: FeatureCollection<
  RegionGeometry,
  SurfaceProperties
> = {
  type: "FeatureCollection",
  features: [],
};
const NEUTRAL_PREDICATE: PointPredicate = () => true;
const AREA_OF_INTEREST_MASK_SOURCE_ID = "area-of-interest-mask-source";
const AREA_OF_INTEREST_MASK_LAYER_ID = "area-of-interest-outside-mask";
const AREA_OF_INTEREST_OUTLINE_LAYER_ID = "area-of-interest-outline";
const WEB_MERCATOR_WORLD_RING: Array<[number, number]> = [
  [-180, -85.051129],
  [180, -85.051129],
  [180, 85.051129],
  [-180, 85.051129],
  [-180, -85.051129],
];
const REGION_STYLE_PROPERTIES = {
  fillColor: "__hostFillColor",
  fillOpacity: "__hostFillOpacity",
  lineColor: "__hostLineColor",
  lineWidth: "__hostLineWidth",
  lineOpacity: "__hostLineOpacity",
} as const;

function areaAroundOrigin(
  [longitude, latitude]: [number, number],
): Feature<Polygon> {
  const angularDistance = AREA_OF_INTEREST_RADIUS_MILES / EARTH_RADIUS_MILES;
  const latitudeDelta = (angularDistance * 180) / Math.PI;
  const longitudeScale = Math.max(
    Math.cos((latitude * Math.PI) / 180),
    0.000001,
  );
  const longitudeDelta = Math.min(180, latitudeDelta / longitudeScale);
  const west = Math.max(-180, longitude - longitudeDelta);
  const east = Math.min(180, longitude + longitudeDelta);
  const south = Math.max(-85.051129, latitude - latitudeDelta);
  const north = Math.min(85.051129, latitude + latitudeDelta);

  return {
    type: "Feature",
    properties: {
      origin: [longitude, latitude],
      radiusMiles: AREA_OF_INTEREST_RADIUS_MILES,
    },
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [west, north],
          [west, south],
          [east, south],
          [east, north],
          [west, north],
        ],
      ],
    },
  };
}

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
      value.latitude >= -85.051129 &&
      value.latitude <= 85.051129
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

function locationsAreEquivalent(
  first: [number, number] | undefined,
  second: [number, number],
) {
  if (!first) return false;
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const latitudeDelta = radians(second[1] - first[1]);
  const longitudeDelta = radians(second[0] - first[0]);
  const firstLatitude = radians(first[1]);
  const secondLatitude = radians(second[1]);
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(firstLatitude) *
      Math.cos(secondLatitude) *
      Math.sin(longitudeDelta / 2) ** 2;
  const distanceMeters =
    2 * 6_371_008.8 * Math.asin(Math.min(1, Math.sqrt(haversine)));
  return distanceMeters <= SAME_LOCATION_THRESHOLD_METERS;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "An unknown error occurred.";
}

function TransientSnack({
  children,
  resetKey,
  role,
  testId,
  className = "",
}: {
  children: ReactNode;
  resetKey: string | number;
  role?: "alert";
  testId?: string;
  className?: string;
}) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    setVisible(true);
    const timeout = window.setTimeout(
      () => setVisible(false),
      SNACK_DURATION_MS,
    );
    return () => window.clearTimeout(timeout);
  }, [resetKey]);

  if (!visible) return null;

  return (
    <div
      className={`rounded-lg bg-slate-950 px-3 py-2 text-xs font-medium text-white shadow-lg shadow-slate-950/25 ${className}`}
      data-testid={testId}
      role={role}
    >
      {children}
    </div>
  );
}

function normalizeResolvedRegions(value: unknown) {
  if (!value || typeof value !== "object") {
    throw new Error("Filter returned invalid regions.");
  }
  const candidate = value as {
    collection?: FeatureCollection<RegionGeometry>;
    itemCount?: number;
  };
  if (
    candidate.collection?.type !== "FeatureCollection" ||
    !candidate.collection.features.every(
      (feature) =>
        feature?.type === "Feature" &&
        ["Polygon", "MultiPolygon"].includes(feature.geometry?.type),
    ) ||
    !Number.isInteger(candidate.itemCount) ||
    (candidate.itemCount ?? -1) < 0
  ) {
    throw new Error("Filter returned invalid regions.");
  }
  return {
    regions: candidate.collection.features as RegionFeature[],
    regionCount: candidate.itemCount as number,
  };
}

function safeMapId(key: string) {
  return key.replace(/[^a-zA-Z0-9_-]/g, "-");
}

function outsideAreaOfInterestMask(
  areaOfInterest: Feature<Polygon> | undefined,
): FeatureCollection<Polygon> {
  return {
    type: "FeatureCollection",
    features: areaOfInterest
      ? [
          {
            type: "Feature",
            properties: {},
            geometry: {
              type: "Polygon",
              coordinates: [
                WEB_MERCATOR_WORLD_RING,
                [...areaOfInterest.geometry.coordinates[0]].reverse(),
              ],
            },
          },
        ]
      : [],
  };
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

function surfaceColorExpression(
  ramp: ReadonlyArray<readonly [number, string]> | undefined,
): FillLayerSpecification["paint"] extends infer Paint
  ? Paint extends { "fill-color"?: infer Color }
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
    ["get", "weight"],
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
  count?: number;
  children?: ReactNode;
  countTestId?: string;
}) {
  const headingId = `${title.toLowerCase().replaceAll(/\s+/g, "-")}-heading`;
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <h2
          id={headingId}
          className="text-xs font-bold tracking-[0.16em] text-slate-500 uppercase"
        >
          {title}
        </h2>
        {count !== undefined ? (
          <span
            className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500"
            data-testid={countTestId}
          >
            {count}
          </span>
        ) : null}
      </div>
      {children}
    </div>
  );
}

function Status({
  runtime,
  onRetry,
  enabled = true,
  showSettledStatus = true,
}: {
  runtime?: FilterRuntime | HeatmapRuntime;
  onRetry: () => void;
  enabled?: boolean;
  showSettledStatus?: boolean;
}) {
  if (!enabled && showSettledStatus) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-500">
        <span className="h-1.5 w-1.5 rounded-full bg-slate-300" />
        Off
      </span>
    );
  }

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
      ("regions" in runtime && !!runtime.regions) ||
      ("points" in runtime && !!runtime.points) ||
      ("surface" in runtime && !!runtime.surface);

    return (
      <div className="flex items-center gap-2">
        <span
          className="max-w-36 truncate text-[11px] font-medium text-rose-600"
          title={runtime.error}
        >
          {hasStaleValue ? "Stale" : (runtime.error ?? "Error")}
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

  if (!showSettledStatus) return null;

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

function OriginDialog({
  proximity,
  onClose,
  onSelect,
}: {
  proximity: [number, number];
  onClose: () => void;
  onSelect: (address: AddressSelection) => void;
}) {
  const listId = useId();
  const requestSequence = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<AddressSelection[]>([]);
  const [message, setMessage] = useState<string>();
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    inputRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  useEffect(() => {
    const normalized = query.trim();
    if (normalized.length < 3) {
      setSuggestions([]);
      setMessage(
        normalized.length > 0
          ? "Type at least 3 characters to search."
          : undefined,
      );
      setSearching(false);
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      const sequence = ++requestSequence.current;
      setSearching(true);
      setMessage(undefined);
      try {
        const results = await searchAddresses(
          normalized,
          controller.signal,
          proximity,
        );
        if (sequence !== requestSequence.current) return;
        setSuggestions(results);
        setMessage(
          results.length
            ? undefined
            : "No matching addresses found. Try a fuller address.",
        );
      } catch (error) {
        if (controller.signal.aborted || sequence !== requestSequence.current)
          return;
        setSuggestions([]);
        setMessage(
          error instanceof Error ? error.message : "Address lookup failed.",
        );
      } finally {
        if (sequence === requestSequence.current) setSearching(false);
      }
    }, 320);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [proximity, query]);

  return (
    <div
      className="absolute inset-0 z-30 grid place-items-center bg-slate-950/45 p-6 backdrop-blur-sm"
      role="presentation"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        aria-describedby="set-origin-description"
        aria-labelledby="set-origin-title"
        aria-modal="true"
        className="w-full max-w-lg rounded-2xl border border-white/80 bg-white p-5 shadow-2xl"
        role="dialog"
      >
        <h2 id="set-origin-title" className="text-base font-bold text-slate-900">
          Set origin
        </h2>
        <p
          id="set-origin-description"
          className="mt-2 text-sm leading-5 text-slate-600"
        >
          Search for an address. Selecting it creates a new Area of Interest
          extending 20 miles in every direction.
        </p>
        <div className="relative mt-4">
          <input
            ref={inputRef}
            aria-autocomplete="list"
            aria-controls={listId}
            aria-expanded={suggestions.length > 0}
            aria-label="Origin address"
            autoComplete="off"
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 pr-9 text-sm text-slate-800 shadow-sm focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 focus:outline-none"
            placeholder="Start typing an address"
            type="text"
            value={query}
            onChange={(event) => {
              setQuery(event.currentTarget.value);
              setSuggestions([]);
              setMessage(undefined);
            }}
          />
          {searching ? (
            <span
              aria-hidden="true"
              className="absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 animate-spin rounded-full border-2 border-slate-300 border-t-indigo-500"
            />
          ) : null}
        </div>
        {suggestions.length ? (
          <ul
            className="mt-2 max-h-60 overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
            id={listId}
            role="listbox"
          >
            {suggestions.map((suggestion) => (
              <li
                key={`${suggestion.address}-${suggestion.center.join(",")}`}
                role="option"
                aria-selected={false}
              >
                <button
                  className="w-full px-3 py-2.5 text-left text-xs leading-5 text-slate-700 hover:bg-indigo-50 focus:bg-indigo-50 focus:outline-none"
                  type="button"
                  onClick={() => onSelect(suggestion)}
                >
                  {suggestion.address}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {message ? (
          <p className="mt-2 text-xs leading-5 text-slate-500" aria-live="polite">
            {message}
          </p>
        ) : null}
        <div className="mt-5 flex justify-end">
          <button
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 focus:ring-2 focus:ring-slate-300 focus:outline-none"
            type="button"
            onClick={onClose}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function ToolbarDropdown({
  label,
  icon,
  options,
  onAdd,
  disabled = false,
}: {
  label: string;
  icon: string;
  options: Array<{ key: string; label: string }>;
  onAdd: (key: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div className="relative" ref={menuRef}>
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={label}
        className="group relative grid size-11 place-items-center rounded-lg border border-slate-200 bg-white text-slate-600 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 hover:text-indigo-600 focus:ring-2 focus:ring-indigo-300 focus:outline-none disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-300"
        disabled={disabled}
        title={label}
        type="button"
        onClick={() => setOpen((current) => !current)}
      >
        <img alt="" aria-hidden="true" className="size-5" src={icon} />
        <span className="pointer-events-none absolute top-full left-1/2 z-30 mt-2 -translate-x-1/2 rounded-md bg-slate-950 px-2 py-1 text-[10px] font-semibold whitespace-nowrap text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
          {label}
        </span>
      </button>
      {open ? (
        <div
          aria-label={`${label} options`}
          className="absolute top-full left-0 z-20 mt-2 min-w-64 overflow-hidden rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl shadow-slate-900/15"
          role="menu"
        >
          {options.length ? (
            options.map((option) => (
              <button
                className="block w-full rounded-lg px-3 py-2 text-left text-xs font-medium text-slate-700 hover:bg-indigo-50 hover:text-indigo-700 focus:bg-indigo-50 focus:text-indigo-700 focus:outline-none"
                key={option.key}
                role="menuitem"
                type="button"
                onClick={() => {
                  onAdd(option.key);
                  setOpen(false);
                }}
              >
                {option.label}
              </button>
            ))
          ) : (
            <p className="px-3 py-2 text-xs text-slate-400">
              Nothing available
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}

function ToolbarButton({
  label,
  icon,
  active = false,
  disabled = false,
  onClick,
}: {
  label: string;
  icon: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      aria-label={label}
      aria-pressed={active}
      className={`group relative grid size-11 place-items-center rounded-lg border shadow-sm transition focus:ring-2 focus:ring-indigo-300 focus:outline-none disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-50 disabled:text-slate-300 ${
        active
          ? "border-indigo-600 bg-indigo-600 text-white"
          : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50 hover:text-indigo-600"
      }`}
      disabled={disabled}
      title={label}
      type="button"
      onClick={onClick}
    >
      <img
        alt=""
        aria-hidden="true"
        className={`size-5 ${active ? "brightness-0 invert" : ""}`}
        src={icon}
      />
      <span className="pointer-events-none absolute top-full left-1/2 z-30 mt-2 -translate-x-1/2 rounded-md bg-slate-950 px-2 py-1 text-[10px] font-semibold whitespace-nowrap text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
        {label}
      </span>
    </button>
  );
}

export default function MapWorkspace() {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const renderedLayerKeysRef = useRef(new Set<string>());
  const contributionInstanceRef = useRef(0);
  const lastLocationRef = useRef(readLastLocation());

  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState<string>();
  const [locationStatus, setLocationStatus] = useState<
    "cached" | "locating" | "located" | "unavailable"
  >(lastLocationRef.current ? "cached" : "locating");
  const [areaOfInterest, setAreaOfInterest] = useState<
    Feature<Polygon> | undefined
  >(() =>
    lastLocationRef.current
      ? areaAroundOrigin(lastLocationRef.current)
      : undefined,
  );
  const [originDialogOpen, setOriginDialogOpen] = useState(false);
  const [resetConfirmationOpen, setResetConfirmationOpen] = useState(false);
  const [activeFilters, setActiveFilters] = useState<ActiveFilter[]>([]);
  const [enabledFilterIds, setEnabledFilterIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [activeHeatmaps, setActiveHeatmaps] = useState<ActiveHeatmap[]>([]);
  const [enabledHeatmapIds, setEnabledHeatmapIds] = useState<Set<string>>(
    () => new Set(),
  );
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

  function applyOrigin(center: [number, number]) {
    if (
      !Number.isFinite(center[0]) ||
      center[0] < -180 ||
      center[0] > 180 ||
      !Number.isFinite(center[1]) ||
      center[1] < -85.051129 ||
      center[1] > 85.051129
    ) {
      return;
    }
    setAreaOfInterest(areaAroundOrigin(center));
    mapRef.current?.jumpTo({
      center,
      zoom: INITIAL_ZOOM,
    });
  }

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
        zoom: INITIAL_ZOOM,
        attributionControl: false,
      });
      mapRef.current = map;
      map.setPadding(MAP_PADDING);
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
          maxZoom: INITIAL_ZOOM,
          duration: 0,
          padding: MAP_PADDING,
        },
        trackUserLocation: false,
        showUserLocation: true,
        showAccuracyCircle: true,
      });
      // MapLibre always updates the camera before emitting "geolocate".
      // Control that hook so a matching cached fix causes no camera movement
      // and every actual location change uses the same workspace zoom.
      (
        geolocate as unknown as {
          _updateCamera: (position: GeolocationPosition) => void;
        }
      )._updateCamera = (position) => {
        const nextLocation: [number, number] = [
          position.coords.longitude,
          position.coords.latitude,
        ];
        if (locationsAreEquivalent(lastLocationRef.current, nextLocation)) {
          return;
        }
        map.jumpTo({
          center: nextLocation,
          zoom: INITIAL_ZOOM,
        });
      };
      geolocate.on("geolocate", (event) => {
        const position = event as unknown as Partial<GeolocationPosition>;
        if (
          typeof position.coords?.longitude === "number" &&
          Number.isFinite(position.coords.longitude) &&
          position.coords.longitude >= -180 &&
          position.coords.longitude <= 180 &&
          typeof position.coords.latitude === "number" &&
          Number.isFinite(position.coords.latitude) &&
          position.coords.latitude >= -85.051129 &&
          position.coords.latitude <= 85.051129
        ) {
          const nextLocation: [number, number] = [
            position.coords.longitude,
            position.coords.latitude,
          ];
          lastLocationRef.current = nextLocation;
          saveLastLocation(...nextLocation);
          setAreaOfInterest(areaAroundOrigin(nextLocation));
          setLocationStatus("located");
        } else {
          setLocationStatus("unavailable");
        }
      });
      geolocate.on("error", () => setLocationStatus("unavailable"));
      map.addControl(geolocate, "top-right");

      const onLoad = () => {
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
        map.remove();
        mapRef.current = null;
      };
    } catch (error) {
      setMapError(errorMessage(error));
    }
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const collection = outsideAreaOfInterestMask(areaOfInterest);
    const source = map.getSource(
      AREA_OF_INTEREST_MASK_SOURCE_ID,
    ) as GeoJSONSource | undefined;
    if (source) {
      source.setData(collection);
    } else {
      map.addSource(AREA_OF_INTEREST_MASK_SOURCE_ID, {
        type: "geojson",
        data: collection,
      });
    }

    if (!map.getLayer(AREA_OF_INTEREST_MASK_LAYER_ID)) {
      const beforeId = map.getLayer("regions-polygon")
        ? "regions-polygon"
        : undefined;
      map.addLayer(
        {
          id: AREA_OF_INTEREST_MASK_LAYER_ID,
          source: AREA_OF_INTEREST_MASK_SOURCE_ID,
          type: "fill",
          paint: {
            "fill-color": "#64748b",
            "fill-opacity": 0.48,
          },
        },
        beforeId,
      );
    }
    if (!map.getLayer(AREA_OF_INTEREST_OUTLINE_LAYER_ID)) {
      map.addLayer({
        id: AREA_OF_INTEREST_OUTLINE_LAYER_ID,
        source: AREA_OF_INTEREST_MASK_SOURCE_ID,
        type: "line",
        paint: {
          "line-color": "#64748b",
          "line-opacity": 0.9,
          "line-width": 1.5,
          "line-dasharray": [1, 2],
        },
      });
    }
  }, [areaOfInterest, mapReady]);

  useEffect(() => {
    const controller = new AbortController();
    if (!areaOfInterest) {
      setFilterRuntime({});
      return () => controller.abort();
    }
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
      const context = {
        signal: controller.signal,
        viewport: regionViewport(areaOfInterest),
        randomSeed: selection.randomSeed,
      };
      const predicatePromise = selection.entry.contribution.resolvePredicate
        ? Promise.resolve(
            selection.entry.contribution.resolvePredicate(
              selection.state,
              context,
            ),
          )
        : Promise.resolve(NEUTRAL_PREDICATE);
      const regionsPromise = selection.entry.contribution.resolveRegions
        ? Promise.resolve(
            selection.entry.contribution.resolveRegions(
              selection.state,
              context,
            ),
          ).then(normalizeResolvedRegions)
        : Promise.resolve({ regions: [] as RegionFeature[], regionCount: 0 });

      Promise.all([predicatePromise, regionsPromise])
        .then(([predicate, resolvedRegions]) => {
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
            [selection.instanceId]: {
              status: "ready",
              predicate,
              ...resolvedRegions,
            },
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
  }, [activeFilters, areaOfInterest]);

  useEffect(() => {
    const controller = new AbortController();
    if (!areaOfInterest) {
      setHeatmapRuntime({});
      return () => controller.abort();
    }
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
      const contribution = selection.entry.contribution;
      const context = {
        signal: controller.signal,
        viewport: regionViewport(areaOfInterest),
        randomSeed: selection.randomSeed,
      };
      const load =
        contribution.kind === "surface"
          ? contribution
              .load(selection.state, context)
              .then(normalizeSurfaceHeatmap)
              .then(({ collection: surface, itemCount }) => ({
                surface,
                itemCount,
              }))
          : contribution
              .load(selection.state, context)
              .then((collection) => ({
                points: normalizeHeatmapFeatures(
                  collection,
                  {
                    extensionId: selection.entry.extension.id,
                    contributionId: contribution.id,
                  },
                  contribution.style,
                ),
                itemCount: collection.features.length,
              }));
      load
        .then((result) => {
          if (
            controller.signal.aborted ||
            !activeKeys.has(selection.instanceId)
          )
            return;
          setHeatmapRuntime((current) => ({
            ...current,
            [selection.instanceId]: { status: "ready", ...result },
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
  }, [activeHeatmaps, areaOfInterest]);

  const enabledFilters = useMemo(
    () =>
      activeFilters.filter(({ instanceId }) =>
        enabledFilterIds.has(instanceId),
      ),
    [activeFilters, enabledFilterIds],
  );
  const enabledHeatmaps = useMemo(
    () =>
      activeHeatmaps.filter(({ instanceId }) =>
        enabledHeatmapIds.has(instanceId),
      ),
    [activeHeatmaps, enabledHeatmapIds],
  );
  const regionFilters = useMemo(
    () =>
      enabledFilters.filter(
        ({ entry }) => !!entry.contribution.resolveRegions,
      ),
    [enabledFilters],
  );
  const constrainedBoundary = useMemo(() => {
    if (!areaOfInterest) return undefined;
    return intersectRegionGroups([
      [areaOfInterest],
      ...regionFilters.map(
        ({ instanceId }) => filterRuntime[instanceId]?.regions ?? [],
      ),
    ]);
  }, [areaOfInterest, filterRuntime, regionFilters]);
  const visibleOwnedRegions = useMemo(() => {
    if (!constrainedBoundary || regionFilters.length === 0) return [];

    const properties = { ...constrainedBoundary.properties };
    for (const { entry } of regionFilters) {
      const style = entry.contribution.regionStyle;
      if (!style) continue;
      if (style.fillColor) {
        properties[REGION_STYLE_PROPERTIES.fillColor] = style.fillColor;
      }
      if (style.fillOpacity !== undefined) {
        properties[REGION_STYLE_PROPERTIES.fillOpacity] = style.fillOpacity;
      }
      if (style.lineColor) {
        properties[REGION_STYLE_PROPERTIES.lineColor] = style.lineColor;
      }
      if (style.lineWidth !== undefined) {
        properties[REGION_STYLE_PROPERTIES.lineWidth] = style.lineWidth;
      }
      if (style.lineOpacity !== undefined) {
        properties[REGION_STYLE_PROPERTIES.lineOpacity] = style.lineOpacity;
      }
    }

    return [{ ...constrainedBoundary, properties }];
  }, [constrainedBoundary, regionFilters]);
  const actionRegions = useMemo<FeatureCollection<RegionGeometry>>(() => {
    return {
      type: "FeatureCollection",
      features: constrainedBoundary ? [constrainedBoundary] : [],
    };
  }, [constrainedBoundary]);
  const actionViewport = areaOfInterest
    ? regionViewport(areaOfInterest)
    : currentViewport();
  const actionsDisabled =
    !mapReady ||
    !areaOfInterest ||
    !constrainedBoundary ||
    enabledFilters.some(
      ({ instanceId, entry }) => {
        const runtime = filterRuntime[instanceId];
        return (
          !!entry.contribution.resolveRegions &&
          (runtime?.status === "loading" ||
            (!runtime?.regions && runtime?.status !== "ready"))
        );
      },
    );

  const groupedPoints = useMemo(() => {
    const groups = new Map<string, FeatureCollection<Point>>();
    for (const { instanceId } of activeHeatmaps) {
      const points = heatmapRuntime[instanceId]?.points ?? [];
      groups.set(instanceId, {
        type: "FeatureCollection",
        features: !areaOfInterest
          ? []
          : composePoints(points, [], [areaOfInterest]).map(
              ({ feature }) => feature,
            ),
      });
    }
    return groups;
  }, [activeHeatmaps, areaOfInterest, heatmapRuntime]);

  const surfaceCollections = useMemo(() => {
    const groups = new Map<
      string,
      FeatureCollection<RegionGeometry, SurfaceProperties>
    >();
    for (const { instanceId, entry } of activeHeatmaps) {
      if (entry.contribution.kind !== "surface") continue;
      const surface =
        heatmapRuntime[instanceId]?.surface ?? EMPTY_SURFACE_COLLECTION;
      groups.set(
        instanceId,
        areaOfInterest
          ? clipSurfaceCollection(surface, [areaOfInterest])
          : EMPTY_SURFACE_COLLECTION,
      );
    }
    return groups;
  }, [activeHeatmaps, areaOfInterest, heatmapRuntime]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const desiredKeys = new Set(
      activeHeatmaps.map(({ instanceId }) => instanceId),
    );
    for (const key of renderedLayerKeysRef.current) {
      if (desiredKeys.has(key)) continue;
      const safeKey = safeMapId(key);
      const layerId = `extension-heatmap-${safeKey}`;
      const pointLayerId = `extension-points-${safeKey}`;
      const surfaceLayerId = `extension-surface-${safeKey}`;
      const sourceId = `extension-source-${safeKey}`;
      if (map.getLayer(pointLayerId)) map.removeLayer(pointLayerId);
      if (map.getLayer(surfaceLayerId)) map.removeLayer(surfaceLayerId);
      if (map.getLayer(layerId)) map.removeLayer(layerId);
      if (map.getSource(sourceId)) map.removeSource(sourceId);
      renderedLayerKeysRef.current.delete(key);
    }

    for (const { entry, instanceId } of activeHeatmaps) {
      const safeKey = safeMapId(instanceId);
      const layerId = `extension-heatmap-${safeKey}`;
      const surfaceLayerId = `extension-surface-${safeKey}`;
      const sourceId = `extension-source-${safeKey}`;
      const isSurface = entry.contribution.kind === "surface";
      const data = isSurface
        ? (surfaceCollections.get(instanceId) ?? EMPTY_SURFACE_COLLECTION)
        : (groupedPoints.get(instanceId) ?? EMPTY_COLLECTION);
      const existingSource = map.getSource(sourceId) as GeoJSONSource | undefined;

      if (existingSource) {
        existingSource.setData(data);
      } else {
        map.addSource(sourceId, { type: "geojson", data });
      }

      if (isSurface && !map.getLayer(surfaceLayerId)) {
        const style = entry.contribution.style;
        const beforeId = map.getLayer("regions-polygon")
          ? "regions-polygon"
          : undefined;
        map.addLayer(
          {
            id: surfaceLayerId,
            source: sourceId,
            type: "fill",
            layout: {
              "fill-sort-key": ["get", "weight"],
            },
            paint: {
              "fill-color": surfaceColorExpression(style.colorRamp),
              "fill-opacity": style.opacity ?? 0.8,
              "fill-outline-color": "rgba(0, 0, 0, 0)",
            },
          },
          beforeId,
        );
      }
      if (!isSurface && !map.getLayer(layerId)) {
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
      if (!isSurface && !map.getLayer(pointLayerId)) {
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
      const visibility = enabledHeatmapIds.has(instanceId)
        ? "visible"
        : "none";
      for (const renderedLayerId of [
        layerId,
        pointLayerId,
        surfaceLayerId,
      ]) {
        if (map.getLayer(renderedLayerId)) {
          map.setLayoutProperty(
            renderedLayerId,
            "visibility",
            visibility,
          );
        }
      }

      renderedLayerKeysRef.current.add(instanceId);
    }
  }, [
    activeHeatmaps,
    enabledHeatmapIds,
    groupedPoints,
    mapReady,
    surfaceCollections,
  ]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const sourceId = "filter-owned-regions-source";
    const fillLayerId = "filter-owned-regions-fill";
    const lineLayerId = "filter-owned-regions-line";
    const collection: FeatureCollection<RegionGeometry> = {
      type: "FeatureCollection",
      features: visibleOwnedRegions,
    };
    const source = map.getSource(sourceId) as GeoJSONSource | undefined;
    if (source) {
      source.setData(collection);
    } else {
      map.addSource(sourceId, { type: "geojson", data: collection });
    }
    const beforeId = map.getLayer("regions-polygon")
      ? "regions-polygon"
      : undefined;
    if (!map.getLayer(fillLayerId)) {
      map.addLayer(
        {
          id: fillLayerId,
          source: sourceId,
          type: "fill",
          paint: {
            "fill-color": [
              "coalesce",
              ["get", REGION_STYLE_PROPERTIES.fillColor],
              "#16a34a",
            ],
            "fill-opacity": [
              "coalesce",
              ["get", REGION_STYLE_PROPERTIES.fillOpacity],
              0.16,
            ],
          },
        },
        beforeId,
      );
    }
    if (!map.getLayer(lineLayerId)) {
      map.addLayer(
        {
          id: lineLayerId,
          source: sourceId,
          type: "line",
          paint: {
            "line-color": [
              "coalesce",
              ["get", REGION_STYLE_PROPERTIES.lineColor],
              "#15803d",
            ],
            "line-width": [
              "coalesce",
              ["get", REGION_STYLE_PROPERTIES.lineWidth],
              2,
            ],
            "line-opacity": [
              "coalesce",
              ["get", REGION_STYLE_PROPERTIES.lineOpacity],
              0.8,
            ],
          },
        },
        beforeId,
      );
    }
  }, [mapReady, visibleOwnedRegions]);

  const addFilter = (key: string) => {
    const entry = extensionRegistry.filters.find(
      (candidate) => candidate.key === key,
    );
    if (!entry) return;
    contributionInstanceRef.current += 1;
    const randomSeed = Math.floor(Math.random() * 2_147_483_647);
    const instanceId = `filter-${contributionInstanceRef.current}`;
    setActiveFilters((current) => [
      ...current,
      {
        instanceId,
        entry,
        state: entry.contribution.initialState,
        revision: 0,
        randomSeed,
      },
    ]);
    setEnabledFilterIds((current) => new Set(current).add(instanceId));
  };

  const addHeatmap = (key: string) => {
    const entry = extensionRegistry.heatmaps.find(
      (candidate) => candidate.key === key,
    );
    if (!entry) return;
    contributionInstanceRef.current += 1;
    const randomSeed = Math.floor(Math.random() * 2_147_483_647);
    const instanceId = `heatmap-${contributionInstanceRef.current}`;
    setActiveHeatmaps((current) => [
      ...current,
      {
        instanceId,
        entry,
        state: entry.contribution.initialState,
        revision: 0,
        randomSeed,
      },
    ]);
    setEnabledHeatmapIds((current) => new Set(current).add(instanceId));
  };

  const locationMessage =
    locationStatus === "located"
      ? "Centered near you"
      : locationStatus === "cached"
        ? "Centered at your last known location"
        : locationStatus === "unavailable"
          ? "Location unavailable — use Set origin"
          : "Finding your location…";
  const resetAll = () => {
    setActiveFilters([]);
    setEnabledFilterIds(new Set());
    setFilterRuntime({});
    setActiveHeatmaps([]);
    setEnabledHeatmapIds(new Set());
    setHeatmapRuntime({});
    setResetConfirmationOpen(false);
  };

  return (
    <main className="relative h-screen min-h-[640px] min-w-[1024px] overflow-hidden bg-slate-200 text-slate-900">
      <div
        ref={mapContainerRef}
        data-testid="map"
        className="!absolute !inset-0"
        aria-label="Interactive places map"
      />

      <aside className="absolute top-4 bottom-4 left-4 z-10 flex w-96 flex-col overflow-hidden rounded-2xl border border-white/70 bg-white/95 shadow-2xl shadow-slate-900/20 backdrop-blur">
        <header className="flex shrink-0 items-center gap-2 border-b border-slate-950 bg-slate-900 px-5 py-4">
          <ToolbarButton
            label="Set origin"
            icon="/icons/origin.svg"
            disabled={!mapReady}
            onClick={() => setOriginDialogOpen(true)}
          />
          <ToolbarDropdown
            label="Add Filter"
            icon="/icons/filter-add.svg"
            options={extensionRegistry.filters.map((entry) => ({
              key: entry.key,
              label: `${entry.extension.name} · ${entry.contribution.name}`,
            }))}
            onAdd={addFilter}
            disabled={!mapReady || !areaOfInterest}
          />
          <ToolbarDropdown
            label="Add Heatmap"
            icon="/icons/heatmap-add.svg"
            options={extensionRegistry.heatmaps.map((entry) => ({
              key: entry.key,
              label: `${entry.extension.name} · ${entry.contribution.name}`,
            }))}
            onAdd={addHeatmap}
            disabled={!mapReady || !areaOfInterest}
          />
          <button
            aria-label="RESET ALL"
            className="group relative ml-auto grid size-11 place-items-center rounded-lg border border-slate-200 bg-white text-red-600 shadow-sm transition hover:border-rose-300 hover:bg-rose-50 focus:ring-2 focus:ring-rose-300 focus:outline-none disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-600 disabled:opacity-40 disabled:hover:border-slate-200 disabled:hover:bg-slate-50"
            disabled={activeFilters.length === 0 && activeHeatmaps.length === 0}
            title="Reset all filters and heatmaps"
            type="button"
            onClick={() => setResetConfirmationOpen(true)}
          >
            <svg
              aria-hidden="true"
              className="size-5"
              fill="none"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="1.8"
              viewBox="0 0 24 24"
            >
              <path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5" />
            </svg>
            <span className="pointer-events-none absolute top-full left-1/2 z-30 mt-2 -translate-x-1/2 rounded-md bg-slate-950 px-2 py-1 text-[10px] font-semibold whitespace-nowrap text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
              Reset all filters and heatmaps
            </span>
          </button>
          <span className="sr-only" data-testid="area-of-interest-count">
            {areaOfInterest ? 1 : 0}
          </span>
        </header>

        <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5">
          {extensionRegistry.actions.length > 0 ? (
            <section className="space-y-3" aria-labelledby="actions-heading">
              <SectionHeading title="Actions" />
              <div className="space-y-2">
                {extensionRegistry.actions.map((entry) => {
                  const Controls = entry.contribution.Controls;
                  return (
                    <Controls
                      key={entry.key}
                      disabled={actionsDisabled}
                      regions={actionRegions}
                      viewport={actionViewport}
                    />
                  );
                })}
              </div>
            </section>
          ) : null}

          <section className="space-y-3" aria-labelledby="filters-heading">
            <SectionHeading title="Filters" count={activeFilters.length} />
            {activeFilters.length === 0 ? (
              <EmptyState>No active filters</EmptyState>
            ) : (
              <div className="space-y-2">
                {activeFilters.map((selection) => {
                  const runtime = filterRuntime[selection.instanceId];
                  const Controls = selection.entry.contribution.Controls;
                  const enabled = enabledFilterIds.has(selection.instanceId);
                  return (
                    <article
                      key={selection.instanceId}
                      className={`rounded-xl border bg-white p-3 shadow-sm transition-opacity ${
                        enabled
                          ? "border-slate-200"
                          : "border-slate-200/70 opacity-70"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <p className="min-w-0 truncate text-xs font-semibold text-slate-900">
                          {selection.entry.contribution.name}
                        </p>
                        <div className="flex items-center gap-2">
                          <Status
                            runtime={runtime}
                            enabled={enabled}
                            showSettledStatus={false}
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
                            aria-checked={enabled}
                            aria-label={`${selection.entry.contribution.name} enabled`}
                            className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus:ring-2 focus:ring-indigo-400 focus:ring-offset-1 focus:outline-none ${
                              enabled ? "bg-indigo-600" : "bg-slate-300"
                            }`}
                            role="switch"
                            title={`${enabled ? "Disable" : "Enable"} ${selection.entry.contribution.name}`}
                            type="button"
                            onClick={() =>
                              setEnabledFilterIds((current) => {
                                const next = new Set(current);
                                if (enabled) {
                                  next.delete(selection.instanceId);
                                } else {
                                  next.add(selection.instanceId);
                                }
                                return next;
                              })
                            }
                          >
                            <span
                              aria-hidden="true"
                              className={`h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform ${
                                enabled ? "translate-x-4.5" : "translate-x-0.5"
                              }`}
                            />
                          </button>
                          <button
                            aria-label={`Remove ${selection.entry.contribution.name}`}
                            className="rounded-md px-1.5 py-0.5 text-lg leading-none text-slate-300 hover:bg-slate-100 hover:text-slate-600 focus:ring-2 focus:ring-slate-300 focus:outline-none"
                            type="button"
                            onClick={() => {
                              setActiveFilters((current) =>
                                current.filter(
                                  (item) =>
                                    item.instanceId !== selection.instanceId,
                                ),
                              );
                              setEnabledFilterIds((current) => {
                                const next = new Set(current);
                                next.delete(selection.instanceId);
                                return next;
                              });
                            }}
                          >
                            ×
                          </button>
                        </div>
                      </div>
                      <div className="mt-3 border-t border-slate-100 pt-3">
                        <Controls
                          value={selection.state}
                          disabled={!enabled}
                          loading={runtime?.status === "loading"}
                          viewport={actionViewport}
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
            {activeHeatmaps.length === 0 ? (
              <EmptyState>No active heatmaps</EmptyState>
            ) : (
              <div className="space-y-2">
                {activeHeatmaps.map((selection) => {
                  const runtime = heatmapRuntime[selection.instanceId];
                  const Controls = selection.entry.contribution.Controls;
                  const enabled = enabledHeatmapIds.has(selection.instanceId);
                  return (
                    <article
                      key={selection.instanceId}
                      className={`rounded-xl border bg-white p-3 shadow-sm transition-opacity ${
                        enabled
                          ? "border-slate-200"
                          : "border-slate-200/70 opacity-70"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <p className="min-w-0 truncate text-xs font-semibold text-slate-900">
                          {selection.entry.contribution.name}
                        </p>
                        <div className="flex items-center gap-2">
                          <Status
                            runtime={runtime}
                            enabled={enabled}
                            showSettledStatus={false}
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
                            aria-checked={enabled}
                            aria-label={`${selection.entry.contribution.name} visible`}
                            className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus:ring-2 focus:ring-indigo-400 focus:ring-offset-1 focus:outline-none ${
                              enabled ? "bg-indigo-600" : "bg-slate-300"
                            }`}
                            role="switch"
                            title={`${enabled ? "Hide" : "Show"} ${selection.entry.contribution.name}`}
                            type="button"
                            onClick={() =>
                              setEnabledHeatmapIds((current) => {
                                const next = new Set(current);
                                if (enabled) {
                                  next.delete(selection.instanceId);
                                } else {
                                  next.add(selection.instanceId);
                                }
                                return next;
                              })
                            }
                          >
                            <span
                              aria-hidden="true"
                              className={`h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform ${
                                enabled ? "translate-x-4.5" : "translate-x-0.5"
                              }`}
                            />
                          </button>
                          <button
                            aria-label={`Remove ${selection.entry.contribution.name}`}
                            className="rounded-md px-1.5 py-0.5 text-lg leading-none text-slate-300 hover:bg-slate-100 hover:text-slate-600 focus:ring-2 focus:ring-slate-300 focus:outline-none"
                            type="button"
                            onClick={() => {
                              setActiveHeatmaps((current) =>
                                current.filter(
                                  (item) =>
                                    item.instanceId !== selection.instanceId,
                                ),
                              );
                              setEnabledHeatmapIds((current) => {
                                const next = new Set(current);
                                next.delete(selection.instanceId);
                                return next;
                              });
                            }}
                          >
                            ×
                          </button>
                        </div>
                      </div>
                      {Controls ? (
                        <div className="mt-3 border-t border-slate-100 pt-3">
                          <Controls
                            value={selection.state}
                            disabled={!enabled}
                            loading={runtime?.status === "loading"}
                            viewport={actionViewport}
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

      {originDialogOpen ? (
        <OriginDialog
          proximity={actionViewport.center}
          onClose={() => setOriginDialogOpen(false)}
          onSelect={(address) => {
            applyOrigin(address.center);
            setOriginDialogOpen(false);
          }}
        />
      ) : null}

      {resetConfirmationOpen ? (
        <div
          className="absolute inset-0 z-30 grid place-items-center bg-slate-950/45 p-6 backdrop-blur-sm"
          role="presentation"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) {
              setResetConfirmationOpen(false);
            }
          }}
        >
          <div
            aria-describedby="clear-contributions-description"
            aria-labelledby="clear-contributions-title"
            aria-modal="true"
            className="w-full max-w-md rounded-2xl border border-white/80 bg-white p-5 shadow-2xl"
            role="dialog"
          >
            <h2
              id="clear-contributions-title"
              className="text-base font-bold text-slate-900"
            >
              Reset all filters and heatmaps?
            </h2>
            <p
              id="clear-contributions-description"
              className="mt-2 text-sm leading-5 text-slate-600"
            >
              This removes every configured filter and heatmap from the map.
              Your Area of Interest will stay in place.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 focus:ring-2 focus:ring-slate-300 focus:outline-none"
                type="button"
                onClick={() => setResetConfirmationOpen(false)}
              >
                Cancel
              </button>
              <button
                className="rounded-lg bg-rose-600 px-3 py-2 text-xs font-semibold text-white hover:bg-rose-700 focus:ring-2 focus:ring-rose-300 focus:outline-none"
                type="button"
                onClick={resetAll}
              >
                Reset all
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div
        className="absolute right-4 bottom-8 z-20 flex max-w-sm flex-col items-end gap-2"
        aria-live="polite"
      >
        {!mapReady ? (
          <TransientSnack resetKey={mapError ?? "loading"}>
            {mapError ? `Map failed: ${mapError}` : "Loading map…"}
          </TransientSnack>
        ) : null}
        <TransientSnack
          resetKey={locationStatus}
          testId="location-status"
        >
          {locationMessage}
        </TransientSnack>
        {mapError && mapReady ? (
          <TransientSnack resetKey={mapError}>
            Base map warning: {mapError}
          </TransientSnack>
        ) : null}
        {enabledFilters.length || enabledHeatmaps.length ? (
          <div
            className="flex flex-col items-end gap-2"
            data-testid="map-active-summary"
          >
            {enabledFilters.length ? (
              <TransientSnack
                resetKey={enabledFilters
                  .map(({ instanceId }) => instanceId)
                  .join(",")}
              >
                {enabledFilters.length} active{" "}
                {enabledFilters.length === 1 ? "filter" : "filters"}
              </TransientSnack>
            ) : null}
            {enabledHeatmaps.map(({ entry, instanceId }) => (
              <TransientSnack
                key={instanceId}
                resetKey={`${heatmapRuntime[instanceId]?.status ?? "pending"}:${heatmapRuntime[instanceId]?.itemCount ?? 0}`}
                className="inline-flex items-center gap-2"
              >
                <span className="h-2 w-2 rounded-full bg-green-500" />
                {entry.contribution.name}
                <span className="text-slate-400">
                  {entry.contribution.kind === "surface"
                    ? (heatmapRuntime[instanceId]?.itemCount ?? 0)
                    : (groupedPoints.get(instanceId)?.features.length ?? 0)}
                </span>
              </TransientSnack>
            ))}
          </div>
        ) : null}
      </div>
    </main>
  );
}
