/**
 * @module data/kilimo
 * @description Registration entry point for the five Kenya evidence layers.
 *
 * THE CALL THE APP MAKES (from main.js's boot, or from any later agent that
 * holds `window.__KILIMO__`):
 *
 *   // from src/main.js: `registerKilimoLayers` exported by ./data/kilimo/index.js
 *   registerKilimoLayers({
 *     viewer,                 // Cesium.Viewer               (required)
 *     layerRegistry,          // Map<layerId, layer>         (required)
 *     styleManager,           // StyleManager                (optional)
 *     dataManager,            // DataLayerManager            (optional but
 *     registerLayer,          //   strongly preferred: gives each layer its
 *                             //   row in the existing LAYERS panel)
 *   });
 *
 * LAYER IDS — exactly the ids the `set_layer_visibility` tool schema in
 * `packages/shared/src/tools/kilimo-tools.ts` enumerates:
 *
 *   'wards' | 'programme' | 'prices' | 'depots' | 'farmers'
 *
 * The GEV-era aliases (`kilimo-wards`, …) are ALSO written into the registry
 * as pointers to the same layer objects, so scene recipes or modules that were
 * written against the older convention still resolve. Only the canonical ids
 * are registered with the DataLayerManager, so the panel shows five rows.
 *
 * UNIFORM LAYER CONTRACT — every registered layer exposes:
 *
 *   { id, label, show(), hide(), setVisible(bool), isVisible(), focus(target) }
 *
 * plus the GEV DataLayerManager module members (`name`, `icon`, `source`,
 * `init`, `enable`, `disable`, `update`, `getStats`, `destroy`,
 * `showInTogglePanel`), so `set_layer_visibility` and `fly_to_location` work
 * generically over `layerRegistry.get(id)`.
 *
 * CUSTOM EVENTS dispatched on `window` (documented seams — no imports needed):
 *   `kilimo:farmer-selected` { token, state, wardCode, wardName,
 *                              assignedDepotId, attributes, lat, lon } | null
 *   `kilimo:depot-selected`  { depotId, name, merchant, assetType,
 *                              stockStatus, checkedAt, classification,
 *                              lat, lon } | null
 *   `kilimo:ward-selected`   { wardCode, wardName, constituency, county,
 *                              approximate, lat, lon } | null
 *   `kilimo:layers-ready`    { layerIds: string[] }
 */

import * as Cesium from 'cesium';
import { governorRequestRender } from '../../renderGovernor.js';
import { interruptCameraMotion } from '../../cameraVerbs.js';
import { installEvidenceOverlayLane } from './evidenceBadges.js';
import {
  CONSTITUENCY_NAME,
  COUNTY_CENTROID,
  COUNTY_NAME,
  DEPOTS,
  FARMERS,
  KANDARA_CENTROID,
  WARD_CENTROIDS,
  checkKilimoDataConsistency,
} from './kilimoData.js';
import { createWardLayer, normalizePlace } from './wardLayer.js';
import { createDepotLayer } from './depotLayer.js';
import { createProgrammeLayer } from './programmeLayer.js';
import { createPriceLayer } from './priceLayer.js';
import { createFarmerLayer } from './farmerLayer.js';

/** The canonical layer ids, in panel order. Public contract. */
export const KILIMO_LAYER_IDS = Object.freeze(['wards', 'programme', 'prices', 'depots', 'farmers']);

/** Legacy `kilimo-*` aliases kept resolvable in the registry. */
export const KILIMO_LAYER_ID_ALIASES = Object.freeze({
  'kilimo-wards': 'wards',
  'kilimo-programme': 'programme',
  'kilimo-prices': 'prices',
  'kilimo-depots': 'depots',
  'kilimo-farmers': 'farmers',
});

/** CustomEvent fired once the five layers are registered. */
export const LAYERS_READY_EVENT = 'kilimo:layers-ready';

/** Default camera altitudes per target kind, in metres. */
const TARGET_ALTITUDES = Object.freeze({
  country: 1500000,
  county: 62000,
  constituency: 20000,
  ward: 7000,
  depot: 4500,
  farmer: 5000,
});

/**
 * Static target table for `resolveTarget`, built once. Keys are normalized
 * (lower-case, apostrophes and separators stripped), so "Ng'araria",
 * "ngararia", "NG ARARIA" and "Kagundu-ini"/"kagunduini" all hit.
 * @type {Map<string, {name:string, kind:string, lat:number, lon:number, altitude:number}>}
 */
const TARGETS = (() => {
  const table = new Map();
  /**
   * @param {string} key Raw key (normalized on insert).
   * @param {object} value Target record.
   * @returns {void}
   */
  const put = (key, value) => {
    const normalized = normalizePlace(key);
    if (!normalized || table.has(normalized)) return;
    table.set(normalized, value);
  };

  put('kenya', { name: 'Kenya', kind: 'country', lat: 0.2, lon: 37.9, altitude: TARGET_ALTITUDES.country });
  const county = {
    name: `${COUNTY_NAME} county`,
    kind: 'county',
    lat: COUNTY_CENTROID.lat,
    lon: COUNTY_CENTROID.lon,
    altitude: TARGET_ALTITUDES.county,
  };
  put(COUNTY_NAME, county);
  put('muranga county', county);
  const kandara = {
    name: `${CONSTITUENCY_NAME} constituency`,
    kind: 'constituency',
    lat: KANDARA_CENTROID.lat,
    lon: KANDARA_CENTROID.lon,
    altitude: TARGET_ALTITUDES.constituency,
  };
  put(CONSTITUENCY_NAME, kandara);
  put('kandara constituency', kandara);

  for (const ward of WARD_CENTROIDS) {
    const target = {
      name: `${ward.name} ward`,
      kind: 'ward',
      lat: ward.lat,
      lon: ward.lon,
      altitude: TARGET_ALTITUDES.ward,
    };
    put(ward.name, target);
    put(`${ward.name} ward`, target);
    put(ward.code, target);
  }

  for (const depot of DEPOTS) {
    const target = {
      name: depot.name,
      kind: 'depot',
      lat: depot.lat,
      lon: depot.lon,
      altitude: TARGET_ALTITUDES.depot,
    };
    put(depot.id, target);
    put(depot.name, target);
    if (depot.town) put(depot.town, target);
  }

  for (const farmer of FARMERS) {
    const ward = WARD_CENTROIDS.find((candidate) => candidate.name === farmer.wardName);
    if (!ward) continue;
    put(farmer.token, {
      name: `Farmer token ${farmer.token} (${farmer.wardName})`,
      kind: 'farmer',
      lat: ward.lat,
      lon: ward.lon,
      altitude: TARGET_ALTITUDES.farmer,
    });
  }

  return table;
})();

/**
 * Resolve a place name to camera coordinates.
 *
 * Accepts a ward name or code, the county name, the constituency name, a depot
 * id / name / town, a farmer token, or "Kenya" — case-, apostrophe- and
 * separator-insensitive. Also accepts an already-resolved
 * `{ lat, lon, altitude? }` object, which it validates and passes through.
 *
 * @param {string|{lat:number, lon:number, altitude?:number}} name Target.
 * @returns {{name:string, kind:string, lat:number, lon:number, altitude:number}|null}
 *   Null when nothing matched (callers must NOT invent a location).
 */
export function resolveTarget(name) {
  if (name && typeof name === 'object') {
    const lat = Number(name.lat);
    const lon = Number(name.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    const altitude = Number.isFinite(Number(name.altitude))
      ? Number(name.altitude)
      : TARGET_ALTITUDES.ward;
    return { name: String(name.name || 'custom'), kind: 'custom', lat, lon, altitude };
  }
  const query = normalizePlace(name);
  if (!query) return null;
  const exact = TARGETS.get(query);
  if (exact) return { ...exact };
  // One forgiving pass: a query that contains (or is contained by) a known key
  // resolves, so "fly to Ngararia ward Muranga" still lands.
  for (const [key, value] of TARGETS) {
    if (key.length >= 4 && (query.includes(key) || key.includes(query))) return { ...value };
  }
  return null;
}

/** @returns {string[]} Every resolvable target name (diagnostics/tests). */
export function listResolvableTargets() {
  return [...new Set([...TARGETS.values()].map((target) => target.name))];
}

/**
 * Register the five Kenya evidence layers.
 *
 * @param {object} options
 * @param {Cesium.Viewer} options.viewer The Cesium viewer.
 * @param {Map<string, object>} options.layerRegistry Shared layer registry
 *   (`window.__KILIMO__.layerRegistry`).
 * @param {object} [options.dataManager] DataLayerManager — used to drive
 *   visibility so the LAYERS panel row and the tool layer never disagree.
 * @param {function(object):boolean} [options.registerLayer] Preferred
 *   registration hook (`window.__KILIMO__.registerLayer`); it registers with
 *   the data manager, rebuilds the toggle panel, and fills the registry.
 * @param {object} [options.styleManager] StyleManager, used for camera
 *   ownership when focusing a target.
 * @param {string[]} [options.initialVisible] Layer ids to switch on
 *   immediately. Defaults to the wards layer, which is what the opening scene
 *   expects to see.
 * @returns {{layers: object[], resolveTarget: typeof resolveTarget, focusTarget: function(*):boolean}}
 */
export function registerKilimoLayers({
  viewer,
  layerRegistry,
  dataManager = null,
  registerLayer = null,
  styleManager = null,
  initialVisible = ['wards'],
} = {}) {
  if (!viewer) throw new TypeError('registerKilimoLayers requires a Cesium viewer');
  const registry = layerRegistry instanceof Map ? layerRegistry : new Map();

  const problems = checkKilimoDataConsistency();
  if (problems.length) {
    console.warn('[Kilimo] bundled demo data drifted from the canonical values:', problems);
  }

  // The canvas evidence-chip / watermark / pulse painter. Installed before any
  // layer publishes an entry so the first frame is already decorated.
  installEvidenceOverlayLane();

  /**
   * Fly the camera to a resolved target, interrupting whatever motion owns the
   * camera first so a layer focus never fights a running scene or user drag.
   * @param {string|object} target Anything `resolveTarget` accepts.
   * @returns {boolean} False when the target could not be resolved.
   */
  const focusTarget = (target) => {
    const resolved = resolveTarget(target);
    if (!resolved) {
      console.warn('[Kilimo] focus: unresolved target', target);
      return false;
    }
    const fly = () => {
      interruptCameraMotion('kilimo-focus');
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(resolved.lon, resolved.lat, resolved.altitude),
        orientation: {
          heading: Cesium.Math.toRadians(12),
          pitch: Cesium.Math.toRadians(resolved.kind === 'country' ? -85 : -45),
          roll: 0,
        },
        duration: 2.8,
        easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
      });
      governorRequestRender(`kilimo-focus:${resolved.kind}`);
      return true;
    };
    // Route through the style manager's navigation facade when present: that is
    // where cockpit mode gets to refuse the camera.
    if (typeof styleManager?.runImmediateNavigation === 'function') {
      return styleManager.runImmediateNavigation('kilimo-layer', fly) !== false;
    }
    return fly();
  };

  /**
   * Set a layer's visibility through the data manager when one exists, so the
   * panel button, the scene director and the tool layer agree.
   * @param {string} layerId
   * @param {boolean} visible
   * @returns {Promise<boolean>}
   */
  const setLayerEnabled = async (layerId, visible) => {
    if (dataManager && typeof dataManager.setEnabled === 'function') {
      try {
        await dataManager.setEnabled(layerId, visible, { origin: 'programmatic' });
        return true;
      } catch (error) {
        console.warn(`[Kilimo] setEnabled(${layerId}, ${visible}) failed:`, error);
        return false;
      }
    }
    // No manager (headless/tests): drive the module lifecycle directly.
    const layer = registry.get(layerId);
    if (!layer) return false;
    return visible ? Boolean(await layer.enable(viewer)) : Boolean(layer.disable(viewer));
  };

  const ctx = { viewer, focusTarget, setLayerEnabled, requestRender: governorRequestRender };

  const layers = [
    createWardLayer(ctx),
    createProgrammeLayer(ctx),
    createPriceLayer(ctx),
    createDepotLayer(ctx),
    createFarmerLayer(ctx),
  ];

  for (const layer of layers) {
    let registered = false;
    if (typeof registerLayer === 'function') {
      registered = registerLayer(layer) !== false;
    } else if (dataManager && typeof dataManager.register === 'function') {
      dataManager.register(layer);
      registered = true;
    }
    // Self-register regardless, so `set_layer_visibility` and `fly_to_location`
    // resolve even when the host offered no registration hook.
    if (!registry.has(layer.id)) registry.set(layer.id, layer);
    if (!registered) {
      console.info(`[Kilimo] layer ${layer.id} registered into the registry only (no data manager).`);
    }
  }

  // Alias pointers for the older `kilimo-*` id convention.
  for (const [alias, canonical] of Object.entries(KILIMO_LAYER_ID_ALIASES)) {
    const layer = registry.get(canonical);
    if (layer && !registry.has(alias)) registry.set(alias, layer);
  }

  for (const layerId of Array.isArray(initialVisible) ? initialVisible : []) {
    void setLayerEnabled(layerId, true);
  }

  window.dispatchEvent(new CustomEvent(LAYERS_READY_EVENT, {
    detail: { layerIds: layers.map((layer) => layer.id) },
  }));

  return { layers, resolveTarget, focusTarget };
}

/**
 * Convenience bootstrap for a host that only holds `window.__KILIMO__`.
 * Waits for the handle when it is not there yet (the layers module may load
 * before main.js finishes its async boot).
 * @param {{timeoutMs?:number, initialVisible?:string[]}} [options]
 * @returns {Promise<object|null>} The registration result, or null on timeout.
 */
export async function registerKilimoLayersWhenReady(options = {}) {
  const timeoutMs = Number.isFinite(Number(options.timeoutMs)) ? Number(options.timeoutMs) : 15000;
  const startedAt = Date.now();
  while (!window.__KILIMO__?.viewer) {
    if (Date.now() - startedAt > timeoutMs) {
      console.warn('[Kilimo] window.__KILIMO__ never appeared; layers not registered.');
      return null;
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  const handle = window.__KILIMO__;
  return registerKilimoLayers({
    viewer: handle.viewer,
    layerRegistry: handle.layerRegistry,
    dataManager: handle.dataManager,
    registerLayer: handle.registerLayer,
    styleManager: handle.styleManager,
    initialVisible: options.initialVisible,
  });
}
