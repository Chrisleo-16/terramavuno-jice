/**
 * @module ui
 * @description StyleManager + the glass panel framework — TerraMavuno fork.
 *
 * Slimmed from God's Eye View's 10,300-line ui.js (MIT,
 * https://github.com/bilawalsidhu/gods-eye-view). Everything tied to deleted
 * GEV layers (cockpit mode, CCTV, radio docks, contacts context, detection
 * sliders, share links) is gone. What remains — and what other TerraMavuno
 * modules may rely on:
 *
 *  - the visual-style pipeline (one Cesium PostProcessStage per shader in
 *    src/styles/, 500 ms crossfades, animated `time` uniform);
 *  - bloom control (Cesium's built-in bloom stage, GEV's perceptual ramp);
 *  - the IntelHUD (auto-shows on NVG/FLIR/CRT styles);
 *  - the collapsible glass panel framework (`.panel-collapsible` +
 *    `.panel-collapse-btn[data-collapse-target]`, dock tray toggles);
 *  - map-stack chips (photoreal / bing / esri / osm switcher);
 *  - Kenya location pills + free-text geocode search;
 *  - the SceneDirector-facing API: getCameraState / applyCameraState /
 *    getVisualState / applyVisualState / getContextModeState / setContextMode /
 *    setRecordingMode / runImmediateNavigation / supersedeDeferredNavigation.
 */

import * as Cesium from 'cesium';
import { retroShader } from './styles/retro.js';
import { animeShader } from './styles/anime.js';
import { noirShader } from './styles/noir.js';
import { snowShader } from './styles/snow.js';
import { nightVisionShader } from './styles/surveillance.js';
import { thermalShader } from './styles/thermal.js';
import {
  BLOOM_INTENSITY_DEFAULT,
  BLOOM_SCALE_VERSION,
  bloomStrengthFromIntensity,
  clampBloomIntensity,
  decodeBloomIntensity,
} from './bloom.js';
import { IntelHUD } from './hud.js';
import { flyToGlobeView, searchAndFlyTo } from './locations.js';
import { locationMiniStatus } from './locationStatus.js';
import { interruptCameraMotion } from './cameraVerbs.js';
import { renderMapStackChips, syncMapStackChips } from './mapStackChips.js';
import { initWorldOverlay } from './overlays/worldOverlay.js';
import { setDetectionStyle } from './data/detection.js';
import { governorRequestRender } from './renderGovernor.js';

/** Crossfade duration for style-stage intensity transitions. */
const TRANSITION_DURATION_MS = 500;

/** Registered visual styles: name → shader module. */
const STYLES = {
  retro: retroShader,
  surveillance: nightVisionShader,
  thermal: thermalShader,
  anime: animeShader,
  noir: noirShader,
  snow: snowShader,
};

/** Compact display names for the ACTIVE STYLE indicator. */
const STYLE_DISPLAY_NAMES = { surveillance: 'NVG', thermal: 'FLIR', retro: 'CRT' };

/**
 * Kenya location pills for the LOCATION tray. The Kandara-area wards are where
 * the P0 farmer journey lives; Nairobi is the cinematic intro beat.
 * `alt` is camera height in meters; pitch/heading tuned for an oblique look.
 */
const KENYA_LOCATIONS = [
  { id: 'kenya', name: 'Kenya', lat: 0.2, lon: 37.9, alt: 1500000, pitch: -90, heading: 0 },
  { id: 'nairobi', name: 'Nairobi', lat: -1.2921, lon: 36.8219, alt: 3000, pitch: -32, heading: 20 },
  { id: 'muranga', name: "Murang'a", lat: -0.85, lon: 36.95, alt: 35000, pitch: -45, heading: 0 },
  { id: 'kandara', name: 'Kandara', lat: -0.85, lon: 36.95, alt: 12000, pitch: -40, heading: 10 },
];

/**
 * StyleManager — visual styles, HUD, panels, map stack, and locations.
 * The single UI orchestrator main.js constructs; also consumed by
 * scenes/director.js and (via window.__KILIMO__) the action/chat agents.
 */
export class StyleManager {
  /**
   * @param {Cesium.Viewer} viewer
   * @param {{ mapStackController?: object|null }} [options]
   */
  constructor(viewer, { mapStackController = null } = {}) {
    this.viewer = viewer;
    this.mapStackController = mapStackController;

    /** @type {string} Active style name ('normal' or a STYLES key). */
    this.activeStyle = 'normal';
    /** @type {Record<string, Cesium.PostProcessStage>} */
    this.stages = {};
    /** @type {Map<string, {start: number, from: number, to: number}>} */
    this.transitions = new Map();
    this._animationFrame = null;
    this._animationStart = null;

    // Share links were removed with the GEV voice stack; the fork always
    // boots to the default Kenya view. Kept as API for main.js parity.
    this.hasShareState = false;
    this.initialRestorePromise = Promise.resolve();

    this.bloomEnabled = false;
    this._bloomIntensity = BLOOM_INTENSITY_DEFAULT;

    this._dataManager = null;
    this._recordingMode = false;
    this._activeCity = null;
    this._searchedLabel = '';

    this._styleIndicator = document.getElementById('active-style-name');
    this._styleMiniValue = document.getElementById('style-mini-value');

    this._initStages();
    this._initBloom();

    // World-overlay canvas labels (used by the Kenya layers for ward/depot
    // callouts). Init here so layers registered later can paint immediately.
    this.worldOverlay = initWorldOverlay(viewer);

    this.hud = new IntelHUD(viewer);

    this._wireStyleButtons();
    this._wireKeyboardShortcuts();
    this._wirePanelFramework();
    this._wireMapStackChips();
    this._wireLocations();
    this._wireTopActions();
  }

  // ── Data manager attachment ─────────────────────────────────────────

  /**
   * Attach the DataLayerManager once layers are registered.
   * @param {object} dataManager
   */
  attachDataManager(dataManager) {
    this._dataManager = dataManager;
    this.hud.attachDataManager(dataManager);
  }

  // ── Style stages ────────────────────────────────────────────────────

  /**
   * Create one PostProcessStage per visual style. Stages start disabled at
   * intensity 0 so crossfades can animate them in.
   */
  _initStages() {
    for (const [name, shader] of Object.entries(STYLES)) {
      const uniforms = { intensity: 0.0 };
      if (shader.fragmentShader.includes('uniform float time')) {
        uniforms.time = 0.0;
      }
      if (shader.uniforms) {
        for (const [uName, uMeta] of Object.entries(shader.uniforms)) {
          uniforms[uName] = uMeta.default;
        }
      }
      const stage = new Cesium.PostProcessStage({
        name: `terraMavuno_${name}`,
        fragmentShader: shader.fragmentShader,
        uniforms,
      });
      stage.enabled = false;
      this.viewer.scene.postProcessStages.add(stage);
      this.stages[name] = stage;
    }
    this._stageEntries = Object.entries(this.stages);
  }

  /**
   * Single write path for stage intensity: keeps `enabled` in lockstep so
   * zero-intensity stages cost nothing.
   * @param {Cesium.PostProcessStage} stage
   * @param {number} value Intensity in [0, 1].
   */
  _setStageIntensity(stage, value) {
    if (!stage) return;
    stage.uniforms.intensity = value;
    stage.enabled = value > 0.001;
    if (stage.enabled && stage.uniforms.time !== undefined) this._startAnimationLoop();
    governorRequestRender('style-stage');
  }

  /**
   * Enqueue a smooth intensity crossfade for a stage.
   * @param {string} styleName
   * @param {number} fromValue
   * @param {number} toValue
   */
  _startTransition(styleName, fromValue, toValue) {
    this.transitions.set(styleName, {
      start: performance.now(),
      from: fromValue,
      to: toValue,
    });
    this._startAnimationLoop();
  }

  /**
   * Drive crossfades + animated `time` uniforms. Self-stops when no
   * transition is pending and no visible stage animates.
   */
  _startAnimationLoop() {
    if (this._animationFrame !== null) return;
    if (this._animationStart === null) this._animationStart = performance.now();
    const tick = () => {
      const now = performance.now();
      let busy = false;

      for (const [styleName, transition] of [...this.transitions]) {
        const t = Math.min(1, (now - transition.start) / TRANSITION_DURATION_MS);
        // Smoothstep easing
        const eased = t * t * (3 - 2 * t);
        const value = transition.from + (transition.to - transition.from) * eased;
        this._setStageIntensity(this.stages[styleName], value);
        if (t >= 1) this.transitions.delete(styleName);
        else busy = true;
      }

      for (const [, stage] of this._stageEntries) {
        if (stage.enabled && stage.uniforms.time !== undefined) {
          stage.uniforms.time = (now - this._animationStart) / 1000;
          busy = true;
        }
      }

      if (busy) {
        governorRequestRender('style-anim');
        this._animationFrame = requestAnimationFrame(tick);
      } else {
        this._animationFrame = null;
      }
    };
    this._animationFrame = requestAnimationFrame(tick);
  }

  /**
   * Switch the active visual style with a crossfade.
   * @param {string} styleName 'normal' or a STYLES key.
   */
  setStyle(styleName, { applyPreset = true } = {}) {
    void applyPreset; // GEV per-style post-processing presets were removed.
    if (!(styleName === 'normal' || STYLES[styleName])) return;
    if (styleName === this.activeStyle) return;

    const previousStyle = this.activeStyle;
    this.activeStyle = styleName;
    document.documentElement.dataset.gevStyle = styleName;

    if (previousStyle !== 'normal' && this.stages[previousStyle]) {
      this._startTransition(previousStyle, this.stages[previousStyle].uniforms.intensity, 0.0);
    }
    if (styleName !== 'normal' && this.stages[styleName]) {
      this._startTransition(styleName, this.stages[styleName].uniforms.intensity, 1.0);
    }

    document.querySelectorAll('.style-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.style === styleName);
    });

    const displayName = STYLE_DISPLAY_NAMES[styleName] || styleName.toUpperCase();
    if (this._styleIndicator) this._styleIndicator.textContent = displayName;
    if (this._styleMiniValue) this._styleMiniValue.textContent = displayName;

    this.hud.onStyleChange(styleName);
    setDetectionStyle(styleName);
    window.dispatchEvent(new CustomEvent('gev:style-change', { detail: { style: styleName } }));
  }

  _wireStyleButtons() {
    document.querySelectorAll('.style-btn').forEach((btn) => {
      btn.addEventListener('click', () => this.setStyle(btn.dataset.style));
    });
  }

  _wireKeyboardShortcuts() {
    const keyMap = {
      1: 'normal', 2: 'retro', 3: 'surveillance', 4: 'thermal',
      5: 'anime', 6: 'noir', 7: 'snow',
    };
    document.addEventListener('keydown', (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target;
      if (target instanceof HTMLElement
        && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }
      if (keyMap[e.key]) this.setStyle(keyMap[e.key]);
      if (e.key === 'h' || e.key === 'H') this.hud.toggle();
    });
  }

  // ── Bloom ───────────────────────────────────────────────────────────

  _initBloom() {
    this._bloomStage = this.viewer.scene.postProcessStages.bloom;
    this._bloomStage.enabled = false;
    this._bloomStage.uniforms.glowOnly = false;
    this._bloomStage.uniforms.contrast = 256.0;
    this._bloomStage.uniforms.brightness = -0.35;
    this._bloomStage.uniforms.delta = 0.25;
    this._bloomStage.uniforms.sigma = 0.35;
    this._bloomStage.uniforms.stepSize = 1.0;
  }

  /** @returns {number} Current bloom intensity (0-200). */
  _getBloomIntensity() {
    return this._bloomIntensity;
  }

  /**
   * Map an intensity percentage onto Cesium bloom uniforms with GEV's
   * perceptually linear (smoothstep) ramp.
   * @param {number} intensity 0-200.
   */
  _setBloomIntensity(intensity) {
    governorRequestRender('bloom');
    const clamped = clampBloomIntensity(intensity);
    this._bloomIntensity = clamped;
    if (!this._bloomStage) return;
    const rawStrength = bloomStrengthFromIntensity(clamped);
    const strength = rawStrength <= 0.06 ? 0.0 : ((rawStrength - 0.06) / 0.94);
    const eased = strength * strength * (3.0 - 2.0 * strength);
    this._bloomStage.uniforms.contrast = 255.0 - (eased * 168.0);
    this._bloomStage.uniforms.brightness = -0.5 + (eased * 0.36);
    this._bloomStage.uniforms.sigma = 0.28 + (eased * 6.3);
    this._bloomStage.uniforms.delta = 0.2 + (eased * 2.25);
    this._bloomStage.uniforms.stepSize = 1.0 + (eased * 1.25);
    this._syncBloomStageEnabled();
  }

  _setBloomEnabled(enabled) {
    this.bloomEnabled = Boolean(enabled);
    this._syncBloomStageEnabled();
    governorRequestRender('bloom');
  }

  _syncBloomStageEnabled() {
    if (!this._bloomStage) return;
    const strength = bloomStrengthFromIntensity(this._getBloomIntensity());
    this._bloomStage.enabled = this.bloomEnabled && strength > 0.06;
  }

  // ── Panel framework ─────────────────────────────────────────────────

  /**
   * Generic collapse/expand wiring for every `.panel-collapsible`:
   *  - `.panel-collapse-btn[data-collapse-target]` toggles `.collapsed`;
   *  - `.dock-tray-toggle[data-dock-toggle-target]` (command-dock trays)
   *    toggles `.collapsed` and mirrors `aria-expanded`.
   */
  _wirePanelFramework() {
    document.querySelectorAll('.panel-collapse-btn[data-collapse-target]').forEach((btn) => {
      btn.addEventListener('click', (event) => {
        event.stopPropagation();
        const panel = document.getElementById(btn.dataset.collapseTarget);
        if (!panel) return;
        const collapsed = panel.classList.toggle('collapsed');
        btn.textContent = collapsed ? '+' : '−';
      });
    });

    document.querySelectorAll('.dock-tray-toggle[data-dock-toggle-target]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const panel = document.getElementById(btn.dataset.dockToggleTarget);
        if (!panel) return;
        const collapsed = panel.classList.toggle('collapsed');
        btn.setAttribute('aria-expanded', String(!collapsed));
      });
    });

    // Collapsed dock trays expand when their header area is clicked.
    document.querySelectorAll('#location-bar .location-toolbar').forEach((bar) => {
      bar.addEventListener('click', (event) => {
        if (event.target.closest('.panel-collapse-btn')) return;
        document.getElementById('location-bar')?.classList.toggle('collapsed');
      });
    });
  }

  // ── Map stack chips ─────────────────────────────────────────────────

  _wireMapStackChips() {
    const container = document.getElementById('map-stack-chips');
    const statusEl = document.getElementById('map-stack-status');
    const controller = this.mapStackController;
    if (!container || !controller) return;

    const paint = () => {
      renderMapStackChips(container, controller.getStacks(), {
        activeId: controller.getActiveId(),
        onSelect: (id) => {
          void controller.setStack(id).catch((error) => {
            console.warn('[MapStack] switch failed:', error);
          });
        },
      });
      if (statusEl) {
        statusEl.textContent = controller.getActiveId() === 'photoreal' ? '3D' : '2D';
      }
    };

    paint();
    window.addEventListener('gev:map-stack-changed', (event) => {
      const state = event.detail || {};
      if (state.status === 'ready' || state.status === 'error') paint();
      else syncMapStackChips(container, controller.getActiveId());
    });
  }

  // ── Locations ───────────────────────────────────────────────────────

  _flyToKenyaLocation(loc) {
    interruptCameraMotion('location-pill');
    this.viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(loc.lon, loc.lat, loc.alt),
      orientation: {
        heading: Cesium.Math.toRadians(loc.heading || 0),
        pitch: Cesium.Math.toRadians(loc.pitch || -45),
        roll: 0,
      },
      duration: 3.0,
      easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
    });
    this._activeCity = { name: loc.name, pois: [] };
    this._searchedLabel = '';
    this._updateLocationMiniStatus();
  }

  _updateLocationMiniStatus() {
    const lines = locationMiniStatus({
      city: this._activeCity,
      currentPoi: null,
      searchedLabel: this._searchedLabel,
    });
    const cityEl = document.getElementById('location-mini-city');
    const poiEl = document.getElementById('location-mini-poi');
    if (cityEl) cityEl.textContent = lines.city;
    if (poiEl) poiEl.textContent = lines.poi;
  }

  _wireLocations() {
    const pillRow = document.getElementById('location-pills');
    if (pillRow) {
      for (const loc of KENYA_LOCATIONS) {
        const pill = document.createElement('button');
        pill.type = 'button';
        pill.className = 'location-pill';
        pill.dataset.locationId = loc.id;
        pill.textContent = loc.name.toUpperCase();
        pill.addEventListener('click', () => this._flyToKenyaLocation(loc));
        pillRow.appendChild(pill);
      }
    }

    const searchInput = document.getElementById('location-search');
    const searchToggle = document.getElementById('search-toggle');
    const runSearch = async () => {
      const query = String(searchInput?.value || '').trim();
      if (!query) return;
      try {
        const result = await searchAndFlyTo(this.viewer, query);
        if (result?.label) {
          this._activeCity = null;
          this._searchedLabel = result.label;
          this._updateLocationMiniStatus();
        } else if (result === null) {
          this._toast(`No results for "${query}"`);
        }
      } catch (error) {
        // Keyless installs have no geocoder — an honest miss, not a crash.
        console.warn('[Locations] search unavailable:', error);
        this._toast('Search needs a Google Maps key — use the location pills');
      }
    };
    searchInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') void runSearch();
    });
    searchToggle?.addEventListener('click', () => void runSearch());
  }

  _wireTopActions() {
    document.getElementById('reset-globe-view')?.addEventListener('click', () => {
      interruptCameraMotion('reset-globe');
      flyToGlobeView(this.viewer);
      this._activeCity = null;
      this._searchedLabel = '';
      this._updateLocationMiniStatus();
    });
    document.getElementById('clear-selected-layers')?.addEventListener('click', () => {
      const layers = this._dataManager?.getAll?.() || [];
      for (const layer of layers) {
        if (layer.enabled) void this._dataManager.setEnabled(layer.id, false);
      }
      this._toast('Data layers cleared');
    });
  }

  _toast(message, durationMs = 2600) {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('visible');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => toast.classList.remove('visible'), durationMs);
  }

  // ── SceneDirector / action-runner API ───────────────────────────────

  /** @returns {{lat:number,lon:number,alt:number,heading:number,pitch:number,roll:number}|null} */
  getCameraState() {
    const carto = this.viewer.camera.positionCartographic;
    if (!carto) return null;
    return {
      lat: Cesium.Math.toDegrees(carto.latitude),
      lon: Cesium.Math.toDegrees(carto.longitude),
      alt: carto.height,
      heading: Cesium.Math.toDegrees(this.viewer.camera.heading),
      pitch: Cesium.Math.toDegrees(this.viewer.camera.pitch),
      roll: Cesium.Math.toDegrees(this.viewer.camera.roll),
    };
  }

  /**
   * Fly the camera to a previously captured camera state.
   * @param {object} cameraState As returned by getCameraState().
   * @param {number} [duration=2.8]
   */
  applyCameraState(cameraState, duration = 2.8) {
    if (!cameraState) return;
    this.viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(
        cameraState.lon,
        cameraState.lat,
        cameraState.alt,
      ),
      orientation: {
        heading: Cesium.Math.toRadians(cameraState.heading || 0),
        pitch: Cesium.Math.toRadians(cameraState.pitch || -35),
        roll: Cesium.Math.toRadians(cameraState.roll || 0),
      },
      duration: Math.max(0.2, duration || 0),
      easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
    });
  }

  /**
   * Snapshot the visual state for scene recipes.
   * @returns {object}
   */
  getVisualState() {
    const styleParams = {};
    for (const [styleName, stage] of this._stageEntries) {
      const shader = STYLES[styleName];
      if (!shader?.uniforms) continue;
      styleParams[styleName] = {};
      for (const uniformName of Object.keys(shader.uniforms)) {
        styleParams[styleName][uniformName] = stage.uniforms[uniformName];
      }
    }
    return {
      style: this.activeStyle,
      bloom: {
        enabled: this.bloomEnabled,
        intensity: this._getBloomIntensity(),
        version: BLOOM_SCALE_VERSION,
      },
      hud: {
        visible: this.hud.visible,
        variant: this.hud.getVariant(),
      },
      mapStack: this.mapStackController?.getActiveId?.() || 'photoreal',
      styleParams,
    };
  }

  /**
   * Restore a visual state snapshot (style, bloom, HUD, map stack, uniforms).
   * @param {object} [state]
   * @param {{isCurrent?: (() => boolean)|null}} [options]
   * @returns {Promise<boolean>} Whether the state was committed.
   */
  async applyVisualState(state = {}, { isCurrent = null } = {}) {
    const superseded = () => typeof isCurrent === 'function' && !isCurrent();
    if (superseded()) return false;

    if (state.style && state.style !== this.activeStyle) {
      this.setStyle(state.style, { applyPreset: false });
    }

    const bloomState = state.bloom || {};
    if (typeof bloomState.intensity === 'number') {
      this._setBloomIntensity(decodeBloomIntensity(
        bloomState.intensity,
        bloomState.version ?? BLOOM_SCALE_VERSION,
      ));
    }
    if (typeof bloomState.enabled === 'boolean') {
      this._setBloomEnabled(bloomState.enabled);
    }

    const hudState = state.hud || {};
    if (hudState.variant) this.hud.setVariant(hudState.variant);
    if (typeof hudState.visible === 'boolean') this.hud.setMode(hudState.visible ? 'on' : 'off');

    if (state.mapStack && this.mapStackController
      && state.mapStack !== this.mapStackController.getActiveId?.()) {
      try {
        await this.mapStackController.setStack(state.mapStack);
      } catch (error) {
        console.warn('[Visual] map stack restore failed:', error);
      }
      if (superseded()) return false;
    }

    if (state.styleParams && typeof state.styleParams === 'object') {
      for (const [styleName, params] of Object.entries(state.styleParams)) {
        const stage = this.stages[styleName];
        const shader = STYLES[styleName];
        if (!stage || !shader?.uniforms || !params) continue;
        for (const [uniformName, value] of Object.entries(params)) {
          if (!Object.hasOwn(shader.uniforms, uniformName)) continue;
          if (typeof value === 'number') stage.uniforms[uniformName] = value;
        }
      }
      governorRequestRender('style-params');
    }

    return true;
  }

  /**
   * Context modes (GEV's Contacts / Space Missions) were removed with their
   * layers; the fork is permanently in mode 'off'. Kept because the
   * SceneDirector exits any isolating context mode before scene playback.
   * @returns {{mode: 'off', available: string[]}}
   */
  getContextModeState() {
    return { mode: 'off', available: [] };
  }

  /**
   * @param {string} mode Only 'off' is meaningful in this fork.
   * @returns {Promise<{ok: boolean, mode: 'off'}>}
   */
  async setContextMode(mode) {
    return { ok: mode === 'off' || mode === null || mode === undefined, mode: 'off' };
  }

  /**
   * Recording mode hides non-essential chrome (body.recording-mode in CSS).
   * @param {boolean} enabled
   * @param {object} [options] Accepted for GEV API parity; unused.
   */
  setRecordingMode(enabled, options = {}) {
    void options;
    this._recordingMode = Boolean(enabled);
    document.body.classList.toggle('recording-mode', this._recordingMode);
  }

  /**
   * Immediate navigation gate (ported contract): a direct navigation verb
   * interrupts any in-flight camera motion, then runs.
   * @param {string} noun Debug label for the navigation source.
   * @param {() => any} navigate
   * @returns {any} The navigate() result.
   */
  runImmediateNavigation(noun, navigate) {
    interruptCameraMotion(`navigate:${noun}`);
    this.supersedeDeferredNavigation();
    return navigate();
  }

  /** Deferred navigations were a share-restore concept; nothing defers now. */
  supersedeDeferredNavigation() {}
}
