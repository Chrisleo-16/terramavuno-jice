/**
 * @module data/localLayers
 * @description Bundled (no-network) data layers.
 *
 * TerraMavuno fork: all GEV bundled datasets (submarine cables, datacenters,
 * dams, FIRMS) were removed for licensing and scope. Kenya layers (wards,
 * depots, farmers, programme, prices) are authored under `src/data/kilimo/`
 * by their own modules and registered at runtime through
 * `window.__KILIMO__.registerLayer(...)` (see src/main.js) — they are NOT
 * listed here, so this module stays an empty, stable seam.
 *
 * `createLocalGeoJsonLayer` (./localGeojson.js) remains available and is the
 * recommended way to build a bundled GeoJSON layer with world-overlay labels.
 */

export default [];
