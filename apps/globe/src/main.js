/**
 * TERRAMAVUNO — "Nielekeze by TerraMavuno" — Main Entry Point.
 *
 * Forked from God's Eye View (MIT,
 * https://github.com/bilawalsidhu/gods-eye-view): CesiumJS bootstrap with
 * minimal chrome, MSAA 4, visible credits, Google Photorealistic 3D Tiles
 * with a keyless fallback stack — retargeted at Kenya (Murang'a county).
 *
 * Integration contract for the other TerraMavuno agents (chat / voice /
 * actions / layers) — wire in through `window.__KILIMO__`, do NOT edit
 * this file:
 *
 *   window.__KILIMO__ = {
 *     viewer,              // Cesium.Viewer
 *     layerRegistry,       // Map<layerId, layerModule> — everything registered
 *     registerLayer,       // (layerModule) => boolean — register a Kenya layer
 *                          //   with the DataLayerManager + toggle panel + registry
 *     dataManager,         // DataLayerManager (setEnabled / getAll / setLayerParams)
 *     styleManager,        // StyleManager (setStyle, applyCameraState, hud, ...)
 *     mapStackController,  // basemap switcher (photoreal/bing/esri/osm)
 *     sceneDirector,       // cinematic scene playback
 *     annotations,         // voice/chat whiteboard annotation engine
 *     requestRender,       // (reason) => void — poke the render governor
 *   }
 *
 * DOM mount points reserved for later agents (see index.html):
 *   #kilimo-chat-panel  — Claude chat panel (src/chat/)
 *   #kilimo-result-card — eligibility result card (src/farmerCard/)
 *   #kilimo-mic         — ElevenLabs voice button (src/voice/)
 *
 * LAYER-ID CONVENTION — the id passed to `registerLayer({ id, ... })` is the
 * key used by the scene recipes (src/scenes/recipes.js) and by the
 * `set_layer_visibility` tool, so it is a public contract, not an
 * implementation detail. The Kenya layers use:
 *
 *   kilimo-wards | kilimo-depots | kilimo-farmers | kilimo-programme | kilimo-prices
 *
 * Retained GEV infrastructure worth reusing instead of rewriting:
 *   data/localGeojson.js  — bundled-GeoJSON layer factory (world-overlay
 *                           labels, pick/context wiring) — the fastest path to
 *                           a ward or depot layer.
 *   data/pickRegistry.js  — pick-ownership registry, so two layers with their
 *                           own click handlers do not fight over one click.
 *   data/labelArbiter.js  — label collision arbitration for the canvas overlay.
 *   data/dataCredits.js   — per-source attribution in the credits popover.
 *
 * Verify the wiring without a browser: `npm test --workspace @terramavuno/globe`
 * runs audit-imports.mjs (every import resolves) and audit-dom.mjs (every DOM
 * lookup has a matching element or a null guard).
 */

import * as Cesium from 'cesium';
import { StyleManager } from './ui.js';
import { flyToKenya } from './camera.js';
import { DataLayerManager } from './data/manager.js';
import localDataLayers from './data/localLayers.js';
import { registerDataCredits } from './data/dataCredits.js';
import { SceneDirector } from './scenes/director.js';
import { MapStackController } from './mapStackController.js';
import { initAnnotations } from './annotations/index.js';
import { initLogoGaze } from './logoGaze.js';
import { initCameraVerbs } from './cameraVerbs.js';
import {
  installRenderGovernor,
  getRenderGovernorDiagnostics,
  governorRequestRender,
  holdContinuousRender,
  releaseContinuousRender,
} from './renderGovernor.js';
import { installScopeMask } from './scopeMask.js';
import { registerKilimoLayers } from './data/kilimo/index.js';
import { initKilimoInteraction } from './chat/index.js';
import { loadPhotorealisticTileset } from './mapStartup.js';

initLogoGaze();

/**
 * Layer registry for the Kenya layers (wards, depots, farmers, programme,
 * prices). Later agents import this — or reach it via
 * `window.__KILIMO__.layerRegistry` — and add their layer modules through
 * `window.__KILIMO__.registerLayer(...)`.
 * @type {Map<string, object>}
 */
export const layerRegistry = new Map();

/**
 * Extract a human-readable error message from any thrown value.
 * @param {*} error — caught exception value
 * @returns {string} best-effort error description
 */
function describeError(error) {
  if (!error) return 'Unknown initialization error';
  if (error instanceof Error) {
    if (error.message && error.message.trim()) return error.message.trim();
    return error.name || 'Initialization error';
  }
  if (typeof error === 'string' && error.trim()) return error.trim();
  if (typeof error === 'object') {
    const maybeMessage = String(error.message || error.error || '').trim();
    if (maybeMessage) return maybeMessage;
    try {
      const serialized = JSON.stringify(error);
      if (serialized && serialized !== '{}') return serialized;
    } catch {
      // ignore serialization error
    }
  }
  return String(error);
}

async function init() {
  const loadingScreen = document.getElementById('loading-screen');
  const loaderStatus = loadingScreen.querySelector('.loader-status');

  try {
    loaderStatus.textContent = 'Configuring viewer...';

    // A direct Google key provides Google 3D tiles; a Cesium ion token can
    // host the same tiles and also powers the Bing/world-terrain stacks.
    // Both are optional: the app boots keyless onto Esri imagery.
    const cesiumToken = import.meta.env.CESIUM_ION_TOKEN;
    const googleApiKey = import.meta.env.GOOGLE_MAPS_API_KEY;
    if (googleApiKey) window.__GOOGLE_MAPS_API_KEY__ = googleApiKey;

    // Create the Cesium viewer with minimal chrome
    const viewer = new Cesium.Viewer('cesiumContainer', {
      timeline: false,
      animation: false,
      baseLayerPicker: false,
      geocoder: false,
      homeButton: false,
      sceneModePicker: false,
      navigationHelpButton: false,
      fullscreenButton: false,
      vrButton: false,
      selectionIndicator: false,
      infoBox: false,
      baseLayer: false,
      // Visible attribution container — Google Maps / 3D Tiles credits are
      // required by Google's Terms of Service whenever their content shows,
      // so the credit line stays visible in every mode (styled subtly via
      // #cesium-credits), including the "Data attribution" license popover.
      creditContainer: (() => {
        const el = document.createElement('div');
        el.id = 'cesium-credits';
        document.body.appendChild(el);
        return el;
      })(),
      msaaSamples: 4,
      contextOptions: {
        webgl: {
          preserveDrawingBuffer: true,
        },
      },
    });

    // Cap the default render loop at 60 fps — beyond that is pure GPU burn
    // for a map app whose animations are wall-clock based. (GEV perf item 2)
    viewer.targetFrameRate = 60;

    // Register per-source data attribution into the "Data attribution"
    // popover (Natural Earth, kenya-locations, geoBoundaries/HDX, MoALD,
    // and the SIMULATED demo-data disclaimer).
    registerDataCredits(viewer);

    // Hide Cesium's default globe while photoreal tiles provide their own —
    // the 2D imagery otherwise clips through 3D buildings at close range.
    viewer.scene.globe.show = false;

    // Keep a sky behind the tiles, but soften Cesium's high-intensity
    // default atmosphere so the limb doesn't read as a hard cyan seam.
    viewer.scene.skyAtmosphere.show = true;
    viewer.scene.skyAtmosphere.atmosphereLightIntensity = 18;
    viewer.scene.skyAtmosphere.saturationShift = -0.12;
    viewer.scene.skyAtmosphere.brightnessShift = -0.08;

    loaderStatus.textContent = googleApiKey || cesiumToken
      ? 'Loading Google 3D Tiles...'
      : 'Loading the keyless globe...';
    const photoreal = await loadPhotorealisticTileset(Cesium, {
      googleApiKey,
      cesiumToken,
    });
    const tileset = photoreal.tileset;
    if (tileset) {
      viewer.scene.primitives.add(tileset);
      // Cesium World Terrain intentionally disabled — Google Photorealistic
      // 3D Tiles carry their own terrain and conflict with it at high zoom.
      viewer.scene.globe.show = false;
      console.info(`[Init] Google 3D Tiles loaded via ${photoreal.route}.`);
    } else {
      if (photoreal.errors.length) {
        const tileError = photoreal.errors.at(-1);
        console.warn('[Init] Google 3D Tiles unavailable, using the keyless globe:', tileError);
        loaderStatus.textContent = `Google 3D Tiles unavailable (${describeError(tileError)}). Loading the keyless globe...`;
      }
      viewer.scene.globe.show = true;
    }

    loaderStatus.textContent = 'Initializing systems...';

    const mapStackController = new MapStackController(viewer, {
      googleTileset: tileset,
      cesiumToken,
      initialStack: tileset ? 'photoreal' : 'esri-imagery',
      // Rebroadcast stack changes as a window CustomEvent so UI/layers can
      // react without coupling MapStackController to them.
      onChange: (state) => {
        window.dispatchEvent(new CustomEvent('gev:map-stack-changed', { detail: state }));
      },
      onError: (message) => console.warn('[MapStack]', message),
    });
    await mapStackController.setStack(tileset ? 'photoreal' : 'esri-imagery', { silent: true });

    // Camera verbs (orbit/pan/tilt used by the action runner + scenes).
    // The view target for orbit is whatever sits under the screen center:
    // a mesh pick when the photoreal tiles are up, the ellipsoid otherwise.
    const getViewTargetCartesian = (v) => {
      const scene = v.scene;
      const canvas = scene.canvas;
      const center = new Cesium.Cartesian2(canvas.clientWidth / 2, canvas.clientHeight / 2);
      try {
        if (scene.pickPositionSupported) {
          const picked = scene.pickPosition(center);
          if (Cesium.defined(picked)) return picked;
        }
      } catch {
        // fall through to the ellipsoid pick
      }
      const onEllipsoid = v.camera.pickEllipsoid(center, scene.globe.ellipsoid);
      return Cesium.defined(onEllipsoid) ? onEllipsoid : null;
    };
    initCameraVerbs(viewer, getViewTargetCartesian);

    // Style manager: post-processing, HUD, panels, map-stack chips, locations.
    const styleManager = new StyleManager(viewer, { mapStackController });

    // Default flight: orbit in over Kenya, settle above Murang'a / Kandara.
    loaderStatus.textContent = "Flying to Murang'a, Kenya...";
    flyToKenya(viewer);

    // Data layer manager. The Kenya layers register through
    // window.__KILIMO__.registerLayer AFTER boot, so registrations are
    // deliberately never finalized here (finalization exists for GEV's
    // share-link restore, which this fork removed).
    const dataManager = new DataLayerManager(viewer, {
      allowQaRegistration: import.meta.env.DEV,
    });

    /**
     * Register a Kenya data layer with the manager, the LAYERS toggle
     * panel, and the shared layer registry.
     * @param {object} layerModule GEV-style layer module ({id, name, init,
     *   setVisible, update, getStats, destroy, ...}).
     * @returns {boolean} True when registered; false on duplicate/invalid.
     */
    const registerLayer = (layerModule) => {
      if (!layerModule?.id) {
        console.warn('[Kilimo] registerLayer: layer module needs an id');
        return false;
      }
      if (layerRegistry.has(layerModule.id)) {
        console.warn(`[Kilimo] registerLayer: duplicate layer id ${layerModule.id}`);
        return false;
      }
      dataManager.register(layerModule);
      layerRegistry.set(layerModule.id, layerModule);
      dataManager.buildTogglePanel(document.getElementById('data-toggles'));
      return true;
    };

    // Bundled local layers (empty in this fork — kept as the seam).
    for (const layer of localDataLayers) {
      registerLayer(layer);
    }
    dataManager.buildTogglePanel(document.getElementById('data-toggles'));
    styleManager.attachDataManager(dataManager);

    // Deterministic scene playback (cinematic Kenya recipes).
    const sceneDirector = new SceneDirector(viewer, styleManager, dataManager);

    // The "whiteboard" annotation engine (world-space renderer) — the chat
    // and voice agents drive it to trace wards/depots while narrating.
    const annotations = initAnnotations({ viewer, tileset });

    // Reveal once the intro flight is underway.
    void new Promise((resolve) => setTimeout(resolve, 1200)).finally(() => {
      loadingScreen.classList.add('hidden');
    });

    // Idle render governor: requestRenderMode whenever nothing animates.
    // Installed AFTER every module above has registered pre-install holds.
    installRenderGovernor(viewer);

    // The circular scope mask — GEV's signature framing device.
    installScopeMask(viewer);

    // Tracking an entity is a per-frame animation for the follow camera.
    viewer.trackedEntityChanged.addEventListener(() => {
      if (viewer.trackedEntity) holdContinuousRender('tracked-entity');
      else releaseContinuousRender('tracked-entity');
    });

    // Hidden-tab suspension: a hidden canvas repaints for nobody.
    const syncVisibilitySuspension = () => {
      const hidden = document.hidden;
      viewer.useDefaultRenderLoop = !hidden;
      if (!hidden) {
        if (dataManager._panelRefreshPendingOnVisible) {
          dataManager._panelRefreshPendingOnVisible = false;
          dataManager._refreshTogglePanel();
        }
        governorRequestRender('visibility-restore');
      }
    };
    document.addEventListener('visibilitychange', syncVisibilitySuspension);
    syncVisibilitySuspension();

    /**
     * THE integration handle. Later agents (src/chat/, src/voice/,
     * src/actions/, src/farmerCard/, src/data/kilimo/) attach through this —
     * never by editing main.js. See the module docblock for the contract.
     */
    window.__KILIMO__ = {
      viewer,
      layerRegistry,
      registerLayer,
      dataManager,
      styleManager,
      mapStackController,
      sceneDirector,
      annotations,
      tileset,
      getRenderGovernorDiagnostics,
      requestRender: governorRequestRender,
    };
    // Back-compat alias for ported GEV modules that probe window.__godsEyeView.
    window.__godsEyeView = window.__KILIMO__;

    // The five Kenya evidence layers (wards / programme / prices / depots /
    // farmers). Registered here — after the handle exists — through the
    // documented registerLayer hook, so they get their LAYERS-panel rows and
    // land in layerRegistry under the ids the tool schema uses.
    registerKilimoLayers({
      viewer,
      layerRegistry,
      dataManager,
      registerLayer,
      styleManager,
      initialVisible: ['wards'],
    });

    // Interaction layer: the action runner, Claude chat panel, farmer result
    // card and ElevenLabs voice button. Mounted last, after the handle and the
    // layers exist, so runMavunoAction can resolve targets and toggle layers.
    // Never allowed to break the globe — a failure here degrades to map-only.
    initKilimoInteraction({ viewer, layerRegistry }).catch((error) => {
      console.warn('Kilimo interaction layer unavailable (map still works):', error);
    });

  } catch (error) {
    console.error('TerraMavuno initialization failed:', error);
    loaderStatus.textContent = `Error: ${describeError(error)}`;
    loaderStatus.style.color = '#ff4444';
  }
}

init();
