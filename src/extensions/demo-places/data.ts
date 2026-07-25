import type { FeatureCollection, Point } from "geojson";
import type { MapViewport } from "../api";

interface DemoProperties {
  name: string;
  weight: number;
}

export function seededRandom(seed: number) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let result = value;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomPlaces(
  viewport: MapViewport,
  seed: number,
  pointCount: number,
): FeatureCollection<Point, DemoProperties> {
  const random = seededRandom(seed);
  const { west, south, east, north } = viewport.bounds;
  const longitudeSpan = Math.max(east - west, 0.01);
  const latitudeSpan = Math.max(north - south, 0.01);
  const clusters = Array.from({ length: 6 }, () => ({
    longitude: west + longitudeSpan * (0.12 + random() * 0.76),
    latitude: south + latitudeSpan * (0.12 + random() * 0.76),
    spread: 0.025 + random() * 0.055,
  }));

  return {
    type: "FeatureCollection",
    features: Array.from({ length: pointCount }, (_, index) => {
      const cluster = clusters[Math.floor(random() * clusters.length)];
      const angle = random() * Math.PI * 2;
      const distance = Math.sqrt(random()) * cluster.spread;
      const longitude = Math.min(
        east,
        Math.max(
          west,
          cluster.longitude + Math.cos(angle) * longitudeSpan * distance,
        ),
      );
      const latitude = Math.min(
        north,
        Math.max(
          south,
          cluster.latitude + Math.sin(angle) * latitudeSpan * distance,
        ),
      );

      return {
        type: "Feature",
        id: `random-${seed}-${index}`,
        geometry: {
          type: "Point",
          coordinates: [longitude, latitude],
        },
        properties: {
          name: `Random place ${index + 1}`,
          weight: 1 + Math.floor(random() * 10),
        },
      };
    }),
  };
}
