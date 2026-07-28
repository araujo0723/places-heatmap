import type {
  Feature,
  FeatureCollection,
  MultiPolygon,
  Polygon,
} from "geojson";
import type {
  RegionGeometry,
  ResolvedRegions,
  SurfaceProperties,
} from "../../api";

export const MAX_INCOME = 300_000;

export interface IncomeProperties extends SurfaceProperties {
  geoid: string;
  name: string;
  income: number;
  marginOfError?: number;
}

export type IncomeFeature = Feature<RegionGeometry, IncomeProperties>;
export type IncomeCollection = FeatureCollection<
  RegionGeometry,
  IncomeProperties
>;

function polygonsOf(geometry: Polygon | MultiPolygon) {
  return geometry.type === "Polygon"
    ? [geometry.coordinates]
    : geometry.coordinates;
}

export function incomeWeight(income: number) {
  return Math.min(1, Math.max(0, income / MAX_INCOME));
}

export function filterIncomeRegions(
  collection: IncomeCollection,
  minimumIncome: number,
): ResolvedRegions {
  const selected = collection.features.filter(
    ({ properties }) => properties.income >= minimumIncome,
  );
  if (selected.length === 0) {
    return {
      collection: { type: "FeatureCollection", features: [] },
      itemCount: 0,
    };
  }

  return {
    collection: {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {},
          geometry: {
            type: "MultiPolygon",
            coordinates: selected.flatMap(({ geometry }) =>
              polygonsOf(geometry),
            ),
          },
        },
      ],
    },
    itemCount: selected.length,
  };
}

export function incomeHeatSurface(
  collection: IncomeCollection,
): FeatureCollection<RegionGeometry, SurfaceProperties> {
  return {
    type: "FeatureCollection",
    features: collection.features.map((feature) => ({
      ...feature,
      properties: feature.properties,
    })),
  };
}
