/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly PUBLIC_BASEMAP_TILE_URL?: string;
  readonly PUBLIC_BASEMAP_ATTRIBUTION?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
