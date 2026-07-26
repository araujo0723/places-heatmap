# Places Heatmap

An Astro-based desktop map workspace with auto-discovered filters and heatmaps.
The page shell is rendered by Astro, while the interactive MapLibre workspace is
a React client island.

On startup, the map requests browser geolocation and centers on the user's
region at OpenStreetMap zoom 10 when permission is granted. The map reserves
space for the sidebar when centering. A 40-by-40-mile Area of Interest is
created automatically, extending 20 miles in every direction from the detected
location. The last successful location is stored in local browser storage and
used as the initial origin on later visits, while a fresh location is requested.

## Development

```sh
npm install
npm run dev
```

### Local HTTPS and geolocation

Geolocation requires a secure browser context when the app is opened from a
LAN address such as `10.0.0.247`. For a browser-trusted local certificate,
install [`mkcert`](https://github.com/FiloSottile/mkcert), then run this once:

```sh
npm run setup:https
```

Start the HTTPS server:

```sh
npm run stop # if the HTTP development server is already running
npm run dev:https
```

The app automatically uses the generated certificate. Open
`https://10.0.0.247:4321`. HTTPS uses a strict port so an existing HTTP server
cannot silently move it to a different address.

If `mkcert` is unavailable, `npm run dev:https` falls back to a basic
self-signed certificate covering `localhost`, `127.0.0.1`, and `10.0.0.247`.
That is useful for testing TLS but may not satisfy geolocation until the
certificate is trusted by the browser.

If the LAN address changes, add it to the certificate and set
`LOCAL_HTTPS_HOST` when using the generated self-signed fallback, or provide
another certificate with `LOCAL_HTTPS_CERT` and `LOCAL_HTTPS_KEY`. When viewing
from another device, that device must also trust the certificate authority.

Useful checks:

```sh
npm run check
npm run test
npm run build
npm run test:e2e
```

The app uses the public OpenStreetMap raster endpoint for development. Copy
`.env.example` to `.env` to select another compatible tile endpoint and
attribution.

Park and water lookups use `georgia-latest.osm.pbf` from the project root by
default. Set `OSM_PBF_PATH` to use another local extract. Build the derived
spatial index before starting the app:

```sh
npm run index:osm
```

The index is stored under `.cache/osm/` and automatically rebuilt when the PBF
size or modification time changes. `OSM_INDEX_PATH` can select another cache
location. If the index is missing, the first park or water request builds it
automatically. The APIs query the full requested bounds and do not impose an
Overpass-style tile or result limit.

The production build uses Astro's standalone Node adapter. The page shell stays
prerendered while `/api/parks` and `/api/water` run on the server:

```sh
npm run build
npm start
```

## Extensions

Extensions are trusted source packages. Add or unzip a folder under
`src/extensions/`, then restart the development server or rebuild the app.
Vite discovers every `src/extensions/*/index.tsx` entry automatically. A
missing folder is simply absent from the registry, so removing an extension
does not require editing core registration code.

An extension exports a versioned definition:

```tsx
import { defineExtension } from "../api";

export default defineExtension({
  apiVersion: 1,
  id: "my-extension",
  name: "My extension",
  icon: "/icons/my-extension.svg",
  actions: [],
  filters: [],
  heatmaps: [],
});
```

Action contributions provide always-present custom controls and receive the
Area of Interest viewport plus the host-composed region boundary. The
**Actions** section is omitted when no extension contributes a control. Filter contributions
provide a settings component and can resolve a pure point predicate,
filter-owned regions, or both. Heatmap contributions load either GeoJSON points
or weighted polygon surfaces and provide declarative styling. Filters and
heatmaps receive the Area of Interest viewport and a stable per-instance random seed.
See `src/extensions/nearby-parks/index.tsx` for a working region filter and
surface heatmap.

Extensions never receive the MapLibre instance. The host validates data,
composes all active predicates with the Area of Interest constraint, clips
filter and heatmap geometry to that area, and owns map source/layer lifecycle.

### Self-contained server APIs

An extension can keep its client, core, server, tests, and Astro-style API
pages together:

```text
src/extensions/my-extension/
├── index.tsx
├── core/
├── server/
└── pages/
    └── api/
        ├── places.ts
        └── details/
            └── index.ts
```

The host auto-discovers extension API pages. In this example they are exposed
as `/api/places` and `/api/details`; supported route modules export the normal
Astro method handlers such as `GET`, `POST`, or `ALL`. Route paths must be
unique across installed extensions. Removing the extension folder also removes
its UI contributions and API handlers on the next restart or build; unmatched
extension API requests return `404`.

## Zillow

The bundled Zillow extension adds **GO TO ZILLOW** to **Actions**. It unions
regions from each source, intersects those source boundaries, keeps the largest
components, and simplifies the result to a conservative Zillow vertex budget.
After Zillow accepts the custom boundary, its rentals search opens in a new
tab. The action is disabled until an Area of Interest exists.

## Filter behavior

- A single **Area of Interest** is mandatory before Actions, Filters, and
  Heatmaps become available. It is created automatically from browser
  geolocation and extends 20 miles from the origin in each direction.
- **Set origin** opens address autocomplete. Selecting an address replaces the
  Area of Interest and recalculates every configured filter and heatmap.
- **RESET ALL** removes every configured filter and heatmap after confirmation
  while preserving the current origin and area.
- Active extension filters combine with AND semantics.
- Filters and heatmaps can each be toggled off without discarding their
  configuration or reloading their data.
- Region-producing filters add a host-rendered, non-editable result boundary.
  Their regions are unioned within each filter and intersected across filters,
  so the map shows only the common area.
- Result components at or below 100,000 square meters (about 24.7 acres) are
  removed.
- Filter regions intersect with the Area of Interest, while point predicates
  retain AND semantics for filtered results.
- Every point and surface heatmap is clipped only to the Area of Interest.
  Active filters do not constrain heatmaps, so multiple heatmaps stack
  independently.
- Settings and regions are intentionally session-only in this increment.

## Parks

The bundled Parks extension queries local OpenStreetMap
`leisure=park` objects for the Area of Interest plus 5 km and shares a six-hour
client cache between its filter and heatmap.

- **Parks** under Filters creates a bbox-expanded or circular region for every
  park, from 0 to 2,000 m.
- **Parks** under Heatmaps renders a full-strength park core and twelve geographic
  contour bands fading to zero at 300 m.
- The entire expanded Area of Interest is loaded in one local-index request,
  without a tile or result-count limit.

## Lakes

The bundled Lakes extension queries OpenStreetMap lakes, ponds,
reservoirs, basins, lagoons, oxbows, cenotes, stream pools, reflecting pools,
moats, salt ponds, and unclassified enclosed `natural=water` features from the
local PBF for the Area of Interest plus 5 km. Commonly used `water=fishpond`
records are included,
while explicit linear water types such as rivers, canals, streams, and ditches
are excluded. Its filter and heatmap share a six-hour client cache.

- **Lakes** under Filters creates a blue bbox-expanded or circular region for
  every body of water, from 0 to 2,000 m.
- **Lakes** under Heatmaps renders a blue, full-strength water core and twelve
  geographic contour bands fading to zero at 300 m.
- The entire expanded Area of Interest is loaded in one local-index request,
  without a tile or result-count limit.

## Commute

The bundled Commute extension looks up and validates destination addresses
before requesting driving isochrones from openrouteservice. Set `ORS_API_KEY`
in `.env` to enable both contributions:

- **Commute** under Filters draws a red outline and constrains all active
  data to the selected 5–60 minute region. The slider advances in five-minute
  intervals.
- **Commute** under Heatmaps accepts only an address. It renders exact
  20- and 40-minute contours with additional five-minute transition bands,
  fading from green through yellow to transparent.

Address suggestions use openrouteservice when configured and fall back to
Nominatim. Routing requests and the API key remain server-side.
