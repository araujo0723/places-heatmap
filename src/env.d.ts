/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly PUBLIC_BASEMAP_TILE_URL?: string;
  readonly PUBLIC_BASEMAP_ATTRIBUTION?: string;
  readonly OSM_PBF_PATH?: string;
  readonly OSM_INDEX_PATH?: string;
  readonly ORS_API_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare namespace NodeJS {
  interface ProcessEnv {
    readonly OSM_PBF_PATH?: string;
    readonly OSM_INDEX_PATH?: string;
    readonly ORS_API_KEY?: string;
  }
}
