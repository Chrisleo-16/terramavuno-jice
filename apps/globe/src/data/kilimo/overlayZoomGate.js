/**
 * @module data/kilimo/overlayZoomGate
 * @description Hides detail callouts that are meaningless at the altitude the
 * camera is currently at.
 *
 * WHY: every Kenya layer publishes a world-overlay card — ward name, depot,
 * farmer token, price row — each with its evidence chips. At Kandara zoom that
 * is the point of the product. Zoomed out to the whole country it is a wall of
 * sub-county text stacked over a map you cannot read, and the cards do not
 * shrink with distance, so at 2,200 km they cover a serious fraction of the
 * frame.
 *
 * Each overlay source declares the altitude above which its cards stop being
 * useful. Nothing is unpublished — the entries stay put and the source is only
 * toggled invisible, so coming back down is instant and costs no re-layout.
 *
 * This deliberately does NOT touch the boundary geometry. Outlines still draw
 * at country zoom (that is what tells you it is Kenya); only the text cards
 * come and go.
 */

import { setOverlaySourceVisible } from '../../overlays/worldOverlay.js';

/**
 * Maximum camera altitude, in metres, at which each overlay source still shows
 * its cards.
 *
 * The ordering is the information hierarchy: the county label survives longest
 * because at national zoom "Murang'a" is the one thing worth naming; ward,
 * depot, farmer and price detail all belong to the close-in view.
 */
export const OVERLAY_MAX_ALTITUDE_M = Object.freeze({
  // Ward cards are three or four lines each plus evidence chips. Six of them
  // stacked over a county is unreadable, so they only appear once the camera
  // is close enough that a single ward is the subject — below the ~150 km
  // settled county shot, not at it.
  'kilimo-wards': 95_000,
  'kilimo-depots': 95_000,
  'kilimo-farmers': 70_000,
  'kilimo-prices': 70_000,
  // The programme summary is one card, not one per feature, so it survives out
  // to the regional view where it still says something useful.
  'kilimo-programme': 300_000,
});

/**
 * Re-evaluating on every camera tick would thrash; the gate only changes at a
 * handful of thresholds, so poll at a human cadence instead.
 */
const POLL_MS = 400;

/**
 * Install the zoom gate.
 *
 * @param {object} options
 * @param {import('cesium').Viewer} options.viewer
 * @param {Record<string, number>} [options.thresholds] Override the table,
 *   mainly for tests.
 * @returns {{destroy: function(): void, evaluate: function(): void}}
 */
export function installOverlayZoomGate({ viewer, thresholds = OVERLAY_MAX_ALTITUDE_M } = {}) {
  if (!viewer) throw new TypeError('installOverlayZoomGate requires a Cesium viewer');

  /** Sources we have ever touched, so `destroy` can hand them back visible. */
  const touched = new Set();
  let timer = null;
  let destroyed = false;

  const evaluate = () => {
    if (destroyed) return;
    const altitude = viewer.camera.positionCartographic?.height;
    if (typeof altitude !== 'number' || Number.isNaN(altitude)) return;

    for (const [sourceId, maxAltitude] of Object.entries(thresholds)) {
      // Applied unconditionally, NOT diffed against a cached last-value.
      //
      // The gate does not own overlay visibility — a layer sets its own source
      // visible whenever it enables, which happens asynchronously after boot
      // and again on every toggle in the LAYERS panel. An earlier version
      // cached its own intent and skipped when it matched, so the first
      // "hide" landed before the layer had loaded, and the layer's own
      // "show" afterwards was never corrected: the cards stayed up at every
      // altitude. Re-asserting each tick is the only state-safe option, and
      // setting a boolean 2.5x a second for five sources costs nothing.
      try {
        setOverlaySourceVisible(sourceId, altitude <= maxAltitude);
        touched.add(sourceId);
      } catch {
        // A source that has not been registered yet is not an error — the
        // layer may still be loading. The next tick picks it up.
      }
    }
  };

  timer = setInterval(evaluate, POLL_MS);
  evaluate();

  return {
    evaluate,
    destroy: () => {
      destroyed = true;
      if (timer !== null) clearInterval(timer);
      timer = null;
      // Leave every source visible on the way out: a torn-down gate must not
      // strand a layer hidden.
      for (const sourceId of touched) {
        try {
          setOverlaySourceVisible(sourceId, true);
        } catch {
          // Source already gone; nothing to restore.
        }
      }
      touched.clear();
    },
  };
}
