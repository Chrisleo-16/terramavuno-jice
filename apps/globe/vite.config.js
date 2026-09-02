/**
 * Vite configuration for TerraMavuno "Kilimo, Nitapata?" — the globe app.
 *
 * Slimmed from the God's Eye View config (MIT,
 * https://github.com/bilawalsidhu/gods-eye-view): all ~20 upstream API proxy
 * middlewares, the AISStream websocket bridge, and the in-app key-setup
 * endpoint were removed. All server-side behavior now lives in services/api
 * (Express on :8787), reached through the single `/api` dev proxy below.
 *
 * Env contract:
 * - `envDir` points at the REPO ROOT so one root `.env` serves every
 *   workspace (globe + services/api).
 * - ONLY two values are ever exposed to the browser:
 *   `GOOGLE_MAPS_API_KEY` and `CESIUM_ION_TOKEN` (the latter also accepted
 *   as `VITE_CESIUM_ION_TOKEN`). Every other secret stays server-side.
 *
 * @module vite.config
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import { createRequire } from 'node:module';
import cesium from 'vite-plugin-cesium';

/** Resolve __dirname for ESM context. */
const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Monorepo root — two levels up from apps/globe. One .env for everything. */
const REPO_ROOT = path.resolve(__dirname, '../..');

export default defineConfig(({ mode }) => {
  // Resolve cesium wherever npm actually put it (workspace root or local).
  const cesiumPkg = createRequire(import.meta.url).resolve('cesium/package.json');
  const cesiumBuildRoot = path
    .join(path.dirname(cesiumPkg), 'Build')
    .split(path.sep)
    .join('/');

  // Load the ROOT dotenv files (no prefix filter). Shell values still win.
  const loaded = loadEnv(mode, REPO_ROOT, '');
  for (const [key, val] of Object.entries(loaded)) {
    if (process.env[key] === undefined) process.env[key] = val;
  }
  const env = { ...process.env };

  // CESIUM_ION_TOKEN may be spelled either way in .env; normalize once here.
  const cesiumIonToken = env.CESIUM_ION_TOKEN || env.VITE_CESIUM_ION_TOKEN || '';
  const googleMapsApiKey = env.GOOGLE_MAPS_API_KEY || '';

  const localAllowedHosts = ['localhost', '127.0.0.1', '.local'];

  return {
    envDir: REPO_ROOT,
    // npm workspaces hoist `cesium` to the repo-root node_modules, but
    // vite-plugin-cesium defaults to looking under this package's own
    // node_modules — so the Assets/Workers copy silently fails on build.
    // Point it at the real resolved location.
    plugins: [
      cesium({
        cesiumBuildRootPath: cesiumBuildRoot,
        cesiumBuildPath: `${cesiumBuildRoot}/Cesium/`,
      }),
    ],

    // .geojson is imported for its URL (kilimoData.js fetches it at runtime so
    // the Kenya boundaries stay out of the JS bundle). Without this, Rollup
    // tries to parse the GeoJSON as an ES module and the build fails.
    assetsInclude: ['**/*.geojson'],
    server: {
      host: env.HOST || 'localhost',
      // GLOBE_PORT only — deliberately NOT PORT. The root .env sets PORT for
      // services/api (8787); reading it here would make the globe try to bind
      // the API's port and collide.
      port: parseInt(env.GLOBE_PORT, 10) || 4173,
      strictPort: true,
      allowedHosts: (env.HOST === '0.0.0.0' || env.HOST === '::')
        ? true
        : localAllowedHosts,
      fs: {
        // Never let the dev server serve credentials or git internals.
        deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**'],
      },
      // Framing protection belongs on the APP DOCUMENT: a browser evaluates
      // frame-ancestors against the framed page's own navigation response.
      headers: {
        'X-Frame-Options': 'DENY',
        'Content-Security-Policy': "frame-ancestors 'none'",
      },
      // Everything under /api is served by services/api (Express, :8787):
      // Claude chat SSE, kilimo data endpoints, ElevenLabs signed URLs.
      // Secrets (ANTHROPIC_API_KEY, ELEVENLABS_API_KEY, SUPABASE_SECRET_KEY)
      // live there and never reach this bundle.
      proxy: {
        '/api': {
          target: 'http://localhost:8787',
          changeOrigin: true,
        },
      },
    },
    // Expose ONLY these two values to the browser via import.meta.env.*
    define: {
      'import.meta.env.GOOGLE_MAPS_API_KEY': JSON.stringify(googleMapsApiKey),
      'import.meta.env.CESIUM_ION_TOKEN': JSON.stringify(cesiumIonToken),
    },
    build: {
      // The Cesium engine bundle is inherently large; raise the warning
      // ceiling so the build log isn't dominated by an expected notice.
      chunkSizeWarningLimit: 1500,
    },
  };
});
