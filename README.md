# Places Heatmap

An Astro-based desktop map workspace with auto-discovered filters and heatmaps.
The page shell is rendered by Astro, while the interactive MapLibre workspace is
a React client island.

On startup, the map requests browser geolocation and centers on the user's
region when permission is granted. The last successful location is stored in
local browser storage and used as the initial camera position on later visits,
while a fresh location is requested. The bundled random explorer snapshots the
current viewport when a heatmap is added, so generated results stay around the
area the user is currently viewing.

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
attribution. Production deployments should use a tile service sized for their
traffic.

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
  filters: [],
  heatmaps: [],
});
```

Filter contributions provide a settings component and resolve a pure point
predicate. Heatmap contributions asynchronously load a GeoJSON point collection
and provide declarative heatmap styling. Both receive the current viewport and
a stable per-instance random seed. See
`src/extensions/demo-places/index.tsx` for a working contribution of each type.

Extensions never receive the MapLibre instance. The host validates data,
composes all active predicates with the drawn-region constraint, and owns map
source/layer lifecycle.

## Filter behavior

- Active extension filters combine with AND semantics.
- Adding the bundled random filter draws three generated regions around the
  current map focus; removing that filter removes its generated regions.
- Multiple drawn polygons combine as a union.
- The region union is ANDed with all extension filters.
- Select **Draw region**, then press and drag on the map to trace a freehand
  polygon. Map panning is suspended until the polygon is finished.
- With no regions, the region constraint is neutral.
- Settings and drawn regions are intentionally session-only in this increment.
