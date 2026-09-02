/**
 * mavunoActions.js — THE single browser action runner for both brains
 * (Claude text chat via SSE `client_action` frames, and the ElevenLabs voice
 * agent via client tools).
 *
 * Ports the God's Eye View runner contract (MIT — see apps/globe/NOTICE.md and
 * apps/globe/docs/ported/gev-action-runner-contract.md):
 *   1. dedupe consecutive identical calls (name+args) and repeated call ids
 *   2. a newer fly_to_location supersedes the in-flight camera move
 *   3. EVERY call is answered — the runner always resolves, never throws
 *   4. per-turn AbortController signal is observed across every await
 *   5. staleness (`isCurrent()`) is re-checked after every async boundary
 *      BEFORE anything touches the viewer / layers / panels
 *
 * Only the 3 UI tools from packages/shared/src/tools/kilimo-tools.ts are
 * handled here (fly_to_location, set_layer_visibility, show_result_card);
 * data tools are server-executed. Unknown names resolve { ok:false, error }.
 */

import * as Cesium from 'cesium';
import { interruptCameraMotion } from '../cameraVerbs.js';
import centroids from '../data/local_data/kenya/centroids.json';
import depotsFile from '../data/local_data/kenya/depots.muranga.json';

/** The 5 layer ids the shared tool schema allows. */
export const KILIMO_LAYER_IDS = Object.freeze(['wards', 'programme', 'prices', 'depots', 'farmers']);

/** Altitudes (metres) used when the model does not ask for one. */
const DEFAULT_ALTITUDE_M = Object.freeze({ country: 900000, county: 90000, ward: 14000, depot: 2500 });

const FLY_DURATION_S = 3.0;
const DEDUPE_WINDOW_MS = 8000;

/** Normalize a place/target string for fuzzy matching (apostrophes, dashes, case). */
function normalizeName(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[‘’`']/g, '')
    .replace(/[^a-z0-9]+/g, '');
}

/**
 * Built-in gazetteer fallback, used when the layers' resolveTarget() is absent
 * or cannot resolve. Ward/county centroids come from the bundled
 * data/local_data/kenya/centroids.json (calculated — label/camera use only);
 * depots from depots.muranga.json.
 */
function buildGazetteer() {
  /** @type {Map<string, {name:string, lat:number, lon:number, altitudeMeters:number, kind:string}>} */
  const map = new Map();
  const add = (name, lat, lon, altitudeMeters, kind, aliases = []) => {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    const entry = { name, lat, lon, altitudeMeters, kind };
    for (const key of [name, ...aliases]) {
      const k = normalizeName(key);
      if (k && !map.has(k)) map.set(k, entry);
    }
  };

  add('Kenya', 0.02, 37.9, DEFAULT_ALTITUDE_M.country, 'country');
  add('Nairobi', -1.2921, 36.8219, 30000, 'city');
  add('Kandara', -0.85, 36.95, DEFAULT_ALTITUDE_M.county, 'constituency', ['Kandara Constituency']);

  for (const county of centroids?.counties ?? []) {
    add(county.name, county.lat, county.lon, DEFAULT_ALTITUDE_M.county, 'county', [
      `${county.name} County`,
      county.code,
    ]);
  }
  for (const ward of centroids?.wards ?? []) {
    add(ward.name, ward.lat, ward.lon, DEFAULT_ALTITUDE_M.ward, 'ward', [
      `${ward.name} ward`,
      ward.code,
    ]);
  }
  for (const depot of depotsFile?.depots ?? []) {
    add(depot.name, depot.lat, depot.lon, DEFAULT_ALTITUDE_M.depot, 'depot', [
      depot.id,
      depot.town,
      depot.merchant,
    ]);
  }
  // Murang'a is the county fallback if centroids.json ever lacks it.
  if (!map.has(normalizeName("Murang'a"))) {
    add("Murang'a", -0.807, 37.029, DEFAULT_ALTITUDE_M.county, 'county', ['Muranga']);
  }
  return map;
}

const GAZETTEER = buildGazetteer();

/** Look a target up in the built-in gazetteer (exact, then prefix/substring). */
export function lookupGazetteer(target) {
  const key = normalizeName(target);
  if (!key) return null;
  if (GAZETTEER.has(key)) return GAZETTEER.get(key);
  for (const [name, entry] of GAZETTEER) {
    if (name.startsWith(key) || key.startsWith(name) || name.includes(key)) return entry;
  }
  return null;
}

/** Normalize whatever shape the layers' resolveTarget() returns. */
function coerceResolved(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const lat = Number(raw.lat ?? raw.latitude ?? raw.centroid?.lat ?? raw.position?.lat);
  const lon = Number(raw.lon ?? raw.lng ?? raw.longitude ?? raw.centroid?.lon ?? raw.position?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const alt = Number(raw.altitudeMeters ?? raw.altitude ?? raw.height);
  return {
    name: String(raw.name ?? raw.label ?? raw.id ?? 'target'),
    lat,
    lon,
    altitudeMeters: Number.isFinite(alt) && alt > 0 ? alt : DEFAULT_ALTITUDE_M.ward,
    kind: String(raw.kind ?? raw.type ?? 'place'),
  };
}

function describe(error) {
  if (!error) return 'unknown error';
  if (error instanceof Error) return error.message || error.name;
  return String(error);
}

/**
 * Create the runner.
 *
 * @param {object} deps
 * @param {object} deps.viewer  Cesium viewer (window.__KILIMO__.viewer).
 * @param {Map<string, object>|Record<string, object>} [deps.layerRegistry]
 *        id -> GEV-style layer module.
 * @param {(target: string) => (object|Promise<object>)} [deps.resolveTarget]
 *        The kilimo layers' target resolver; falls back to the gazetteer.
 * @param {(decision: object) => void} [deps.showResultCard] Decision renderer.
 * @returns {(name: string, args?: object, runOptions?: {signal?: AbortSignal, isCurrent?: () => boolean, callId?: string}) => Promise<object>}
 */
export function createMavunoActionRunner({ viewer, layerRegistry, resolveTarget, showResultCard } = {}) {
  /** Gate 1 state. */
  let lastSignature = null;
  let lastSignatureAt = 0;
  const seenCallIds = new Set();
  /** Gate 2 state: the in-flight fly_to, so a newer one can supersede it. */
  let activeFlight = null;
  let flightSeq = 0;

  const fresh = (runOptions) =>
    !runOptions?.signal?.aborted &&
    (typeof runOptions?.isCurrent !== 'function' || runOptions.isCurrent());

  const superseded = (action) => ({
    ok: false,
    superseded: true,
    action,
    error: `${action} was superseded by a newer turn — nothing was applied.`,
  });

  /** Fly the camera; resolves when the flight completes, is cancelled, or times out. */
  function flyTo(place, runOptions) {
    const seq = ++flightSeq;
    // Gate 2: explicit navigation interrupts any active camera motion/tracking
    // and cancels the previous flight.
    interruptCameraMotion('mavuno-fly-to');
    if (activeFlight && activeFlight.seq !== seq) activeFlight.cancel('replaced');
    try {
      if (viewer?.trackedEntity) viewer.trackedEntity = undefined;
    } catch {
      /* tracked entity is best-effort */
    }

    return new Promise((resolve) => {
      let settled = false;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        runOptions?.signal?.removeEventListener?.('abort', onAbort);
        if (activeFlight?.seq === seq) activeFlight = null;
        resolve(result);
      };
      const cancel = (reason) => {
        try {
          viewer?.camera?.cancelFlight?.();
        } catch {
          /* ignore */
        }
        finish({
          ok: false,
          superseded: true,
          action: 'fly_to_location',
          error: `Camera move cancelled (${reason}).`,
        });
      };
      const onAbort = () => cancel('turn aborted');
      activeFlight = { seq, cancel };
      runOptions?.signal?.addEventListener?.('abort', onAbort, { once: true });

      // Never hang: resolve even if Cesium's callbacks never fire.
      const timer = setTimeout(
        () =>
          finish({
            ok: true,
            action: 'fly_to_location',
            target: place.name,
            altitudeMeters: place.altitudeMeters,
            note: 'camera move started (completion not confirmed)',
          }),
        (FLY_DURATION_S + 3) * 1000,
      );

      const arrived = () =>
        finish({
          ok: true,
          action: 'fly_to_location',
          target: place.name,
          kind: place.kind,
          lat: place.lat,
          lon: place.lon,
          altitudeMeters: place.altitudeMeters,
          note: `Camera is now over ${place.name}.`,
        });

      try {
        viewer.camera.flyTo({
          destination: Cesium.Cartesian3.fromDegrees(place.lon, place.lat, place.altitudeMeters),
          orientation: {
            heading: 0,
            pitch: Cesium.Math.toRadians(place.kind === 'depot' ? -45 : -60),
            roll: 0,
          },
          duration: FLY_DURATION_S,
          complete: arrived,
          cancel: () => cancel('interrupted'),
        });
      } catch (error) {
        finish({ ok: false, action: 'fly_to_location', error: `Camera move failed: ${describe(error)}` });
      }
    });
  }

  async function doFlyTo(args, runOptions) {
    const target = typeof args?.target === 'string' ? args.target.trim() : '';
    if (!target) {
      return { ok: false, action: 'fly_to_location', error: 'fly_to_location needs a target place name.' };
    }

    let place = null;
    if (typeof resolveTarget === 'function') {
      try {
        place = coerceResolved(await resolveTarget(target));
      } catch {
        place = null; // resolver failures fall through to the gazetteer
      }
      // Gate 5: staleness re-check after the await, before touching the camera.
      if (!fresh(runOptions)) return superseded('fly_to_location');
    }
    if (!place) place = lookupGazetteer(target);
    if (!place) {
      return {
        ok: false,
        action: 'fly_to_location',
        error: `I do not have coordinates for "${target}". Known places: Kenya, Nairobi, Murang'a, Kandara, the six Kandara wards, and the four depots.`,
      };
    }

    const altitudeMeters = Number(args?.altitudeMeters);
    const finalPlace =
      Number.isFinite(altitudeMeters) && altitudeMeters >= 200 && altitudeMeters <= 20000000
        ? { ...place, altitudeMeters }
        : place;

    const result = await flyTo(finalPlace, runOptions);
    if (result.ok && !fresh(runOptions)) return superseded('fly_to_location');
    return result;
  }

  function doSetLayerVisibility(args, runOptions) {
    const layer = typeof args?.layer === 'string' ? args.layer.trim().toLowerCase() : '';
    if (!KILIMO_LAYER_IDS.includes(layer)) {
      return {
        ok: false,
        action: 'set_layer_visibility',
        error: `Unknown layer "${args?.layer}" — valid layers are ${KILIMO_LAYER_IDS.join(', ')}.`,
      };
    }
    const visible = args?.visible !== false;
    if (!fresh(runOptions)) return superseded('set_layer_visibility');

    const module = layerRegistry?.get?.(layer) ?? layerRegistry?.[layer];
    if (!module) {
      return {
        ok: false,
        action: 'set_layer_visibility',
        error: `The "${layer}" layer is not loaded on the globe yet.`,
      };
    }
    try {
      if (typeof module.setVisible === 'function') module.setVisible(visible);
      else if (visible && typeof module.show === 'function') module.show();
      else if (!visible && typeof module.hide === 'function') module.hide();
      else if ('visible' in module) module.visible = visible;
      else return { ok: false, action: 'set_layer_visibility', error: `The "${layer}" layer cannot be toggled.` };
    } catch (error) {
      return {
        ok: false,
        action: 'set_layer_visibility',
        error: `Toggling "${layer}" failed: ${describe(error)}`,
      };
    }
    // Echo the RESULTING state, not the request.
    let nowVisible = visible;
    try {
      if (typeof module.isVisible === 'function') nowVisible = Boolean(module.isVisible());
      else if (typeof module.visible === 'boolean') nowVisible = module.visible;
    } catch {
      /* keep the requested value */
    }
    return {
      ok: true,
      action: 'set_layer_visibility',
      layer,
      visible: nowVisible,
      note: `Layer "${layer}" is now ${nowVisible ? 'visible' : 'hidden'}.`,
    };
  }

  function doShowResultCard(args, runOptions) {
    // Defensive: the decision may arrive as the arg itself, nested, or JSON text.
    let decision = args?.decision ?? args?.result ?? args;
    if (typeof decision === 'string') {
      try {
        decision = JSON.parse(decision);
      } catch {
        return { ok: false, action: 'show_result_card', error: 'show_result_card decision was not valid JSON.' };
      }
    }
    if (decision && typeof decision === 'object' && decision.decision && !decision.conclusion) {
      decision = decision.decision;
    }
    if (!decision || typeof decision !== 'object' || !decision.conclusion) {
      return {
        ok: false,
        action: 'show_result_card',
        error: 'show_result_card needs the Decision object returned by evaluate_farmer.',
      };
    }
    if (typeof showResultCard !== 'function') {
      return { ok: false, action: 'show_result_card', error: 'The result card is not mounted.' };
    }
    if (!fresh(runOptions)) return superseded('show_result_card');
    try {
      showResultCard(decision);
    } catch (error) {
      return {
        ok: false,
        action: 'show_result_card',
        error: `Rendering the result card failed: ${describe(error)}`,
      };
    }
    return {
      ok: true,
      action: 'show_result_card',
      farmerToken: decision.farmerToken ?? null,
      conclusion: decision.conclusion,
      note: 'The eligibility card is on screen.',
    };
  }

  /** runMavunoAction — ALWAYS resolves with { ok, ... } or { ok:false, error }. */
  return async function runMavunoAction(name, args = {}, runOptions = {}) {
    const action = String(name ?? '');
    try {
      // Gate 1a: the same call id can arrive twice (two SSE/agent events).
      const callId = runOptions?.callId ? String(runOptions.callId) : null;
      if (callId) {
        if (seenCallIds.has(callId)) {
          return { ok: false, duplicate: true, action, error: `${action} call ${callId} was already handled.` };
        }
        seenCallIds.add(callId);
        if (seenCallIds.size > 200) seenCallIds.clear();
      }

      // Gate 1b: drop a consecutive identical (name+args) call within the window.
      let signature;
      try {
        signature = `${action}:${JSON.stringify(args ?? {})}`;
      } catch {
        signature = `${action}:unserializable-${Date.now()}`;
      }
      const now = Date.now();
      if (signature === lastSignature && now - lastSignatureAt < DEDUPE_WINDOW_MS) {
        return {
          ok: true,
          duplicate: true,
          action,
          note: `${action} was already applied with identical arguments — skipped.`,
        };
      }
      lastSignature = signature;
      lastSignatureAt = now;

      if (!fresh(runOptions)) return superseded(action || 'action');

      switch (action) {
        case 'fly_to_location':
          return await doFlyTo(args, runOptions);
        case 'set_layer_visibility':
          return doSetLayerVisibility(args, runOptions);
        case 'show_result_card':
          return doShowResultCard(args, runOptions);
        default:
          return {
            ok: false,
            action,
            error: `Unknown action "${action}" — the browser handles fly_to_location, set_layer_visibility and show_result_card only.`,
          };
      }
    } catch (error) {
      // Gate 3: never throw to the caller; a brain waiting on this would deadlock.
      return { ok: false, action, error: `Action failed: ${describe(error)}` };
    }
  };
}
