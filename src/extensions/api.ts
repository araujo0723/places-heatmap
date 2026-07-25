import type { ComponentType } from "react";
import type { Feature, FeatureCollection, Point } from "geojson";

export type PointProperties = Record<string, unknown> & { weight: number };

export interface HostedPoint {
  feature: Feature<Point, PointProperties>;
  origin: {
    extensionId: string;
    contributionId: string;
  };
}

export type PointPredicate = (point: HostedPoint) => boolean;

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

export interface ControlProps<State> {
  value: State;
  onChange: (value: State) => void;
  disabled: boolean;
  loading: boolean;
}

export interface FilterContribution<State = unknown> {
  id: string;
  name: string;
  initialState: State;
  Controls: ComponentType<ControlProps<State>>;
  resolvePredicate: (
    state: State,
    context: ContributionContext,
  ) => PointPredicate | Promise<PointPredicate>;
}

export interface HeatmapStyle {
  weightProperty?: string;
  radius?: number;
  intensity?: number;
  opacity?: number;
  colorRamp?: ReadonlyArray<readonly [number, string]>;
}

export interface HeatmapContribution<State = unknown> {
  id: string;
  name: string;
  initialState: State;
  Controls?: ComponentType<ControlProps<State>>;
  load: (
    state: State,
    context: ContributionContext,
  ) => Promise<FeatureCollection<Point>>;
  style: HeatmapStyle;
}

export interface MapExtension {
  apiVersion: 1;
  id: string;
  name: string;
  description?: string;
  filters?: ReadonlyArray<FilterContribution<any>>;
  heatmaps?: ReadonlyArray<HeatmapContribution<any>>;
}

export function defineExtension(extension: MapExtension): MapExtension {
  return extension;
}

export function contributionKey(extensionId: string, contributionId: string) {
  return `${extensionId}/${contributionId}`;
}
