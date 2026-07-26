import type { ComponentType } from "react";
import type {
  Feature,
  FeatureCollection,
  MultiPolygon,
  Point,
  Polygon,
} from "geojson";

export type PointProperties = Record<string, unknown> & { weight: number };

export interface HostedPoint {
  feature: Feature<Point, PointProperties>;
  origin: {
    extensionId: string;
    contributionId: string;
  };
}

export type PointPredicate = (point: HostedPoint) => boolean;
export type RegionGeometry = Polygon | MultiPolygon;
export type RegionFeature = Feature<RegionGeometry>;

export interface ResolvedRegions {
  collection: FeatureCollection<RegionGeometry>;
  itemCount: number;
}

export interface RegionStyle {
  fillColor?: string;
  fillOpacity?: number;
  lineColor?: string;
  lineWidth?: number;
  lineOpacity?: number;
}

export interface MapViewport {
  center: [number, number];
  bounds: {
    west: number;
    south: number;
    east: number;
    north: number;
  };
}

export interface ContributionContext {
  signal: AbortSignal;
  viewport: MapViewport;
  randomSeed: number;
}

export interface HeatmapContributionContext extends ContributionContext {
  regions: FeatureCollection<RegionGeometry>;
}

export interface ControlProps<State> {
  value: State;
  onChange: (value: State) => void;
  disabled: boolean;
  loading: boolean;
  viewport: MapViewport;
}

export interface ActionControlProps {
  disabled: boolean;
  regions: FeatureCollection<RegionGeometry>;
  viewport: MapViewport;
}

export interface ActionContribution {
  id: string;
  name: string;
  Controls: ComponentType<ActionControlProps>;
}

export interface FilterContribution<State = unknown> {
  id: string;
  name: string;
  initialState: State;
  Controls: ComponentType<ControlProps<State>>;
  regionStyle?: RegionStyle;
  resolvePredicate?: (
    state: State,
    context: ContributionContext,
  ) => PointPredicate | Promise<PointPredicate>;
  resolveRegions?: (
    state: State,
    context: ContributionContext,
  ) => ResolvedRegions | Promise<ResolvedRegions>;
}

export interface HeatmapStyle {
  weightProperty?: string;
  radius?: number;
  intensity?: number;
  opacity?: number;
  colorRamp?: ReadonlyArray<readonly [number, string]>;
}

interface BaseHeatmapContribution<State> {
  id: string;
  name: string;
  initialState: State;
  Controls?: ComponentType<ControlProps<State>>;
  style: HeatmapStyle;
}

export interface PointHeatmapContribution<State = unknown>
  extends BaseHeatmapContribution<State> {
  kind?: "points";
  load: (
    state: State,
    context: HeatmapContributionContext,
  ) => Promise<FeatureCollection<Point>>;
}

export interface SurfaceProperties extends Record<string, unknown> {
  weight: number;
}

export interface SurfaceHeatmapData {
  collection: FeatureCollection<RegionGeometry, SurfaceProperties>;
  itemCount: number;
}

export interface SurfaceHeatmapContribution<State = unknown>
  extends BaseHeatmapContribution<State> {
  kind: "surface";
  load: (
    state: State,
    context: HeatmapContributionContext,
  ) => Promise<SurfaceHeatmapData>;
}

export type HeatmapContribution<State = unknown> =
  | PointHeatmapContribution<State>
  | SurfaceHeatmapContribution<State>;

export interface MapExtension {
  apiVersion: 1;
  id: string;
  name: string;
  icon?: string;
  description?: string;
  actions?: ReadonlyArray<ActionContribution>;
  filters?: ReadonlyArray<FilterContribution<any>>;
  heatmaps?: ReadonlyArray<HeatmapContribution<any>>;
}

export function defineExtension(extension: MapExtension): MapExtension {
  return extension;
}

export function contributionKey(extensionId: string, contributionId: string) {
  return `${extensionId}/${contributionId}`;
}
