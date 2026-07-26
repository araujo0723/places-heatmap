import type { APIRoute } from "astro";
import { dispatchExtensionApiRoute } from "../../extensions/server-registry";

export const prerender = false;

export const ALL: APIRoute = (context) =>
  dispatchExtensionApiRoute(context);
