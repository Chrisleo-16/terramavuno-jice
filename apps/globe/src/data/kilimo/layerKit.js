/**
 * @module data/kilimo/layerKit
 * @description Shared plumbing for the five Kilimo layers.
 *
 * Each Kilimo layer must satisfy TWO contracts at once:
 *
 *  1. the GEV `DataLayerManager` module contract — `{ id, name, icon, source,
 *     updateInterval, init, enable, disable, update, getStats, destroy,
 *     showInTogglePanel }` — which is what gives it a row (with a checkbox
 *     button, a live count and a status chip) in the existing LAYERS panel,
 *     no new panel code required; and
 *  2. the uniform Kilimo layer contract the tool layer drives —
 *     `{ id, label, show(), hide(), setVisible(bool), isVisible(), focus(target) }`.
 *
 * `defineKilimoLayer` builds both from one spec so the five layer modules only
 * describe their own geometry, cards and evidence.
 *
 * PERFORMANCE: entries are published ONCE per enable (these datasets are tens
 * of features, not thousands) through the same bounded overlay publisher the
 * bundled GEV layers use, and every mutation ends in `requestRender` rather
 * than a continuous render loop. Only the depot pulse holds a continuous
 * render, and only while a depot is selected.
 */

import { createLocalInfrastructureOverlayPublisher } from '../localGeojson.js';
import { clearEvidenceDecorations, installEvidenceOverlayLane } from './evidenceBadges.js';
import { governorRequestRender } from '../../renderGovernor.js';
import { isOwnedByOtherLayer, registerPickOwner, resolvePickId, unregisterPickOwner } from '../pickRegistry.js';

/** Distance band in which Kilimo cards/labels are visible, in metres. */
export const KILIMO_MAX_DISTANCE_M = 6000000;
/** Ratio of `maxDistance` at which cards start fading out. */
export const KILIMO_FADE_START_RATIO = 0.55;

/**
 * The card/label geometry every Kilimo overlay entry shares, so all five
 * layers de-clutter against each other through one consistent policy in the
 * label arbiter.
 * @param {object} overrides Entry fields to merge on top.
 * @returns {object} Overlay entry fragment.
 */
export function kilimoEntryDefaults(overrides = {}) {
  return {
    variant: 'card',
    collisionGroup: 'ambient-card',
    maxDistance: KILIMO_MAX_DISTANCE_M,
    distanceFadeStartRatio: KILIMO_FADE_START_RATIO,
    distanceScale: { near: 12000, nearValue: 1, far: 900000, farValue: 0.68 },
    edgeFade: 'keyhole',
    horizonCull: true,
    terrainOcclusion: false,
    gapPx: 14,
    placement: 'above',
    minAnchorSeparationPx: 26,
    ...overrides,
  };
}

/**
 * Build a Kilimo layer object satisfying both contracts.
 *
 * @param {object} spec Layer description.
 * @param {string} spec.id Canonical layer id — 'wards' | 'programme' |
 *   'prices' | 'depots' | 'farmers'. This is the id the `set_layer_visibility`
 *   tool sends, so it is a public contract.
 * @param {string} spec.label Human label for the tool layer / chat copy.
 * @param {string} spec.name Panel row name.
 * @param {string} spec.icon Panel row glyph.
 * @param {string} spec.source Attribution string shown in the panel row.
 * @param {object} spec.ctx Layer context from `registerKilimoLayers`
 *   (`{ viewer, requestRender, setLayerEnabled, focusTarget }`).
 * @param {function(Cesium.Viewer):Promise<void>|void} spec.onEnable Build/attach
 *   geometry and publish overlay entries. May throw — the failure is reported
 *   through `getStats().error` and the panel row turns UNAVAILABLE.
 * @param {function(Cesium.Viewer):void} spec.onDisable Detach geometry.
 * @param {function():number} spec.count Feature count for the panel row.
 * @param {string} [spec.overlaySourceId] Overlay source id (defaults to
 *   `kilimo-<id>`); decorations are cleared for it on disable.
 * @param {function(string):({lat:number,lon:number,altitude:number}|null)} [spec.resolve]
 *   Layer-local target resolver used by `focus()` before falling back to the
 *   shared resolver.
 * @param {object} [spec.extra] Extra members merged onto the returned object.
 * @returns {object} The dual-contract layer object.
 */
export function defineKilimoLayer(spec) {
  const {
    id,
    label,
    name,
    icon,
    source,
    ctx,
    onEnable,
    onDisable,
    count,
    overlaySourceId = `kilimo-${spec.id}`,
    resolve = null,
    extra = {},
  } = spec;

  let enabled = false;
  let error = null;
  let lastUpdate = null;
  let destroyed = false;

  const publisher = createLocalInfrastructureOverlayPublisher({ sourceId: overlaySourceId });

  const layer = {
    // ── DataLayerManager module contract ───────────────────────────────
    id,
    name,
    icon,
    source,
    updateInterval: 0,
    statsRefreshInterval: 0,
    showInTogglePanel: true,

    /**
     * @param {Cesium.Viewer} _viewer
     * @returns {void} Nothing to do: geometry is built lazily in enable().
     */
    init: () => {
      installEvidenceOverlayLane();
    },

    /**
     * @param {Cesium.Viewer} viewer
     * @returns {Promise<boolean>} False when the layer failed to attach.
     */
    enable: async (viewer) => {
      if (destroyed) return false;
      error = null;
      try {
        publisher.show();
        await onEnable(viewer, publisher);
        enabled = true;
        lastUpdate = Date.now();
        governorRequestRender(`kilimo-enable:${id}`);
        return true;
      } catch (cause) {
        error = describeLayerError(cause);
        console.warn(`[Kilimo] layer ${id} failed to enable:`, cause);
        publisher.hide();
        clearEvidenceDecorations(overlaySourceId);
        try {
          onDisable(viewer);
        } catch {
          // a failed rollback must not mask the original error
        }
        enabled = false;
        return false;
      }
    },

    /**
     * @param {Cesium.Viewer} viewer
     * @returns {boolean} True when teardown completed.
     */
    disable: (viewer) => {
      enabled = false;
      publisher.hide();
      clearEvidenceDecorations(overlaySourceId);
      try {
        onDisable(viewer);
      } catch (cause) {
        console.warn(`[Kilimo] layer ${id} failed to disable cleanly:`, cause);
        return false;
      }
      governorRequestRender(`kilimo-disable:${id}`);
      return true;
    },

    /** @returns {boolean} No polling: these datasets are bundled and static. */
    update: () => true,

    /**
     * @returns {{count:number, lastUpdate:number|null, error:string|null}}
     *   A dead layer must be distinguishable from an empty one, so a failed
     *   attach surfaces `error` instead of a silent zero.
     */
    getStats: () => ({
      count: enabled ? count() : 0,
      lastUpdate,
      error,
    }),

    /**
     * @param {Cesium.Viewer} viewer
     * @returns {boolean}
     */
    destroy: (viewer) => {
      destroyed = true;
      layer.disable(viewer);
      publisher.destroy();
      return true;
    },

    // ── Uniform Kilimo layer contract ──────────────────────────────────
    label,
    overlaySourceId,

    /** @returns {Promise<boolean>} Resolves once the layer is on. */
    show: () => layer.setVisible(true),
    /** @returns {Promise<boolean>} Resolves once the layer is off. */
    hide: () => layer.setVisible(false),

    /**
     * Set visibility THROUGH the data manager, so the LAYERS panel row, the
     * scene director's layer plan and the tool layer can never disagree about
     * whether a layer is on.
     * @param {boolean} visible
     * @returns {Promise<boolean>}
     */
    setVisible: (visible) => ctx.setLayerEnabled(id, visible !== false),

    /** @returns {boolean} Settled visibility. */
    isVisible: () => enabled,

    /**
     * Fly the camera to a place this layer owns (ward name, depot id/name,
     * county, farmer token), falling back to the shared resolver.
     * @param {string|{lat:number,lon:number,altitude?:number}} target
     * @returns {boolean} False when the target could not be resolved.
     */
    focus: (target) => {
      if (target && typeof target === 'object'
        && Number.isFinite(Number(target.lat)) && Number.isFinite(Number(target.lon))) {
        return ctx.focusTarget(target);
      }
      const local = typeof resolve === 'function' ? resolve(String(target ?? '')) : null;
      return ctx.focusTarget(local || String(target ?? ''));
    },

    ...extra,
  };

  return layer;
}

/**
 * Install a LEFT_CLICK handler that only reacts to entities this layer owns.
 *
 * Ownership is declared to the shared pick registry (`data/pickRegistry.js`)
 * so sibling layers recognize each other's picks and no two layers fight over
 * one click — the documented GEV failure mode.
 *
 * @param {object} options
 * @param {Cesium.Viewer} options.viewer
 * @param {typeof import('cesium')} options.Cesium Cesium namespace (passed in
 *   so this module does not import Cesium twice).
 * @param {string} options.layerId Owning layer id.
 * @param {string} options.prefix Entity-id prefix, e.g. 'kilimo-depot:'.
 * @param {function(string, object|null):void} options.onSelect Called with the
 *   entity id suffix and the picked entity; called with ('' , null) when the
 *   click lands on empty space (and no sibling owns it), so the layer can
 *   clear its own selection.
 * @returns {{destroy:function():void}} Handle.
 */
export function installKilimoPickHandler({ viewer, Cesium, layerId, prefix, onSelect }) {
  const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
  const owns = (pickedId) => typeof pickedId === 'string' && pickedId.startsWith(prefix);
  registerPickOwner(layerId, owns);

  handler.setInputAction((movement) => {
    const picked = viewer.scene.pick(movement.position);
    const pickedId = resolvePickId(picked);
    if (pickedId && owns(pickedId)) {
      onSelect(pickedId.slice(prefix.length), picked?.id ?? null);
      governorRequestRender(`kilimo-pick:${layerId}`);
      return;
    }
    // Another layer owns this pick: leave its selection alone.
    if (pickedId && isOwnedByOtherLayer(layerId, pickedId)) return;
    onSelect('', null);
    governorRequestRender(`kilimo-pick-clear:${layerId}`);
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

  return {
    destroy: () => {
      unregisterPickOwner(layerId);
      if (!handler.isDestroyed()) handler.destroy();
    },
  };
}

/**
 * Reduce a layer attach failure to one short, honest status string. These
 * layers ship their data with the build, so a failure means a missing/corrupt
 * asset, never a slow network.
 * @param {*} cause Thrown value.
 * @returns {string}
 */
export function describeLayerError(cause) {
  if (cause?.name === 'SyntaxError') return 'dataset is malformed';
  const message = String(cause?.message || '').trim();
  return message ? `unavailable (${message})` : 'dataset unavailable';
}
