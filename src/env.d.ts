/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly PUBLIC_BASEMAP_TILE_URL?: string;
  readonly PUBLIC_BASEMAP_ATTRIBUTION?: string;
  readonly REDIS_URL?: string;
  readonly OVERPASS_API_URL?: string;
  readonly ORS_API_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare namespace NodeJS {
  interface ProcessEnv {
    readonly REDIS_URL?: string;
    readonly OVERPASS_API_URL?: string;
    readonly ORS_API_KEY?: string;
  }
}
