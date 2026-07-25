import fs from "node:fs";
import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import node from "@astrojs/node";
import basicSsl from "@vitejs/plugin-basic-ssl";
import tailwindcss from "@tailwindcss/vite";

const localHttps = process.env.LOCAL_HTTPS === "true";
const defaultCertificatePath = ".certs/places-heatmap.pem";
const defaultKeyPath = ".certs/places-heatmap-key.pem";
const hasDefaultCertificate =
  fs.existsSync(defaultCertificatePath) && fs.existsSync(defaultKeyPath);
const certificatePath =
  process.env.LOCAL_HTTPS_CERT ??
  (hasDefaultCertificate ? defaultCertificatePath : undefined);
const keyPath =
  process.env.LOCAL_HTTPS_KEY ??
  (hasDefaultCertificate ? defaultKeyPath : undefined);

if (localHttps && Boolean(certificatePath) !== Boolean(keyPath)) {
  throw new Error(
    "LOCAL_HTTPS_CERT and LOCAL_HTTPS_KEY must be provided together.",
  );
}

const customHttps =
  localHttps && certificatePath && keyPath
    ? {
        cert: fs.readFileSync(certificatePath),
        key: fs.readFileSync(keyPath),
      }
    : undefined;
const basicSslDomains = [
  "localhost",
  "127.0.0.1",
  "10.0.0.247",
  ...(process.env.LOCAL_HTTPS_HOST
    ? [process.env.LOCAL_HTTPS_HOST]
    : []),
];

export default defineConfig({
  adapter: node({ mode: "standalone" }),
  integrations: [react()],
  devToolbar: {
    enabled: false,
  },
  vite: {
    plugins: [
      tailwindcss(),
      ...(localHttps && !customHttps
        ? [
            basicSsl({
              name: "places-heatmap",
              domains: basicSslDomains,
            }),
          ]
        : []),
    ],
    ...(localHttps
      ? {
          server: {
            https: customHttps ?? true,
            strictPort: true,
          },
        }
      : {}),
  },
});
