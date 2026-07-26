import { getLocalOsmIndex } from "../src/server/osm-pbf";

const startedAt = Date.now();
const index = await getLocalOsmIndex();
const seconds = ((Date.now() - startedAt) / 1_000).toFixed(1);

console.log(
  `Local OSM index ready: ${index.parks.length} parks, ${index.waters.length} water features (${seconds}s).`,
);
