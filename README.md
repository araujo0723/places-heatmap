# Places Heatmap

An Astro-based desktop map workspace with auto-discovered filters and heatmaps.
The page shell is rendered by Astro, while the interactive MapLibre workspace is
a React client island.

On startup, the map requests browser geolocation and centers on the user's
region when permission is granted. The last successful location is stored in
local browser storage and used as the initial camera position on later visits,
while a fresh location is requested.

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
attribution and configure the nearby-parks cache:

```sh
REDIS_URL=redis://localhost:6379
```

Park lookups fall back to an in-process cache and live Overpass requests when
Redis is unavailable. `OVERPASS_API_URL` can select another compatible
interpreter. When `ORS_API_KEY` is set, openrouteservice supplies center-only
park records if Overpass is temporarily overloaded. Production deployments
should use map and Overpass services sized for their traffic.

The production build uses Astro's standalone Node adapter. The page shell stays
prerendered while `/api/parks` runs on the server:

```sh
npm run build
npm start
```

## Extensions

Extensions are trusted client-side source modules. Add a folder containing an
`index.tsx` under `src/extensions/`, then restart the development server. Vite
discovers every `src/extensions/*/index.tsx` entry automatically.

An extension exports a versioned definition:

```tsx
import { defineExtension } from "../api";

export default defineExtension({
  apiVersion: 1,
  id: "my-extension",
  name: "My extension",
  actions: [],
  filters: [],
  heatmaps: [],
});
```

Action contributions provide always-present custom controls and receive the
current viewport plus the host-composed region boundary. The **Actions** region
is omitted when no extension contributes a control. Filter contributions
provide a settings component and can resolve a pure point predicate,
filter-owned regions, or both. Heatmap contributions load either GeoJSON points
or weighted polygon surfaces and provide declarative styling. Filters and
heatmaps receive the current viewport and a stable per-instance random seed.
See `src/extensions/nearby-parks/index.tsx` for a working region filter and
surface heatmap.

Extensions never receive the MapLibre instance. The host validates data,
composes all active predicates with the drawn-region constraint, and owns map
source/layer lifecycle.

## Zillow

The bundled Zillow extension adds **GO TO ZILLOW** to **Actions**. It unions
regions from each source, intersects those source boundaries, keeps the largest
components, and simplifies the result to a conservative Zillow vertex budget.
After Zillow accepts the custom boundary, its rentals search opens in a new
tab. The action is disabled until a drawn or filter-owned region exists.

## Filter behavior

- Active extension filters combine with AND semantics.
- Region-producing filters add host-rendered, non-editable regions. Their
  controls replace those regions, and removing the filter removes them.
- Multiple drawn polygons combine as a union.
- Drawn and filter-owned regions form a union which is ANDed with point
  predicates.
- Select **Draw region**, then press and drag on the map to trace a freehand
  polygon. Map panning is suspended until the polygon is finished.
- With no regions, the region constraint is neutral.
- **Clear all** and **Delete selected** affect manually drawn regions only.
- Settings and regions are intentionally session-only in this increment.

## Nearby parks

The bundled Nearby parks extension queries OpenStreetMap `leisure=park` objects
for the visible map plus 5 km. It refreshes after settled map movement and
shares six-hour, zoom-11 tile caches between its filter and heatmap.

- **Park distance** creates a bbox-expanded or circular filter region for every
  park, from 0 to 2,000 m.
- **Park influence** renders a full-strength park core and twelve geographic
  contour bands fading to zero at 300 m.
- Views covering more than 25 cache tiles retain stale data and ask the user to
  zoom in.
