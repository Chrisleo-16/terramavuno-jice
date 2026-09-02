import * as Cesium from 'cesium';

/**
 * Camera presets for notable locations.
 * TerraMavuno default: fly to Murang'a county (Kandara area) on load.
 */
export const CAMERA_PRESETS = {
  // Kandara constituency area, Murang'a county, Kenya.
  muranga: {
    destination: Cesium.Cartesian3.fromDegrees(36.95, -0.85, 35000),
    orientation: {
      heading: Cesium.Math.toRadians(0),
      pitch: Cesium.Math.toRadians(-45),
      roll: 0.0,
    },
  },
  nairobi: {
    destination: Cesium.Cartesian3.fromDegrees(36.8219, -1.2921, 3000),
    orientation: {
      heading: Cesium.Math.toRadians(20),
      pitch: Cesium.Math.toRadians(-32),
      roll: 0.0,
    },
  },
  /**
   * Whole-of-Kenya framing.
   *
   * Altitude is derived, not guessed. Cesium's default 60-degree FOV on a
   * landscape viewport gives a vertical ground extent of roughly 0.70 x
   * altitude, and Kenya is about 1,130 km north to south. At the old
   * 1,500,000 m that is 1,052 km of visible ground — the country did not fit,
   * the scope mask cropped what was left, and it was genuinely hard to tell
   * you were looking at Kenya.
   *
   * 2,200,000 m was picked by screenshotting a sweep (1,400 / 1,800 / 2,200 /
   * 2,800 km), not by arithmetic alone: at 2,200 km the whole country sits
   * inside the scope mask with Lake Victoria, Lake Turkana and the coast for
   * context. 2,800 km was too far for the tile pyramid — imagery and the
   * clamped county outlines both dropped out, leaving a featureless disc.
   */
  kenya: {
    destination: Cesium.Cartesian3.fromDegrees(37.9, 0.4, 2200000),
    orientation: {
      heading: Cesium.Math.toRadians(0),
      pitch: Cesium.Math.toRadians(-90),
      roll: 0.0,
    },
  },
};

/**
 * Fly the camera to a preset location with a smooth animation.
 */
export function flyToPreset(viewer, presetName, duration = 3.0) {
  const preset = CAMERA_PRESETS[presetName];
  if (!preset) return;

  viewer.camera.flyTo({
    destination: preset.destination,
    orientation: preset.orientation,
    duration,
    easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
  });
}

/**
 * Kenya-wide framing: the whole country top-down, used as the opening rest
 * point of the startup flight so the farmer sees the national picture before
 * the camera commits to one county.
 */
export const KENYA_OVERVIEW = CAMERA_PRESETS.kenya;

/**
 * The Kandara constituency footprint, as a sphere the camera can frame.
 * Centre is the constituency centroid; the radius covers the six participating
 * wards with a little air around them so the boundaries are not cropped.
 */
export const KANDARA_EXTENT = new Cesium.BoundingSphere(
  // Murang'a county centroid, not the Kandara centroid: the settled shot is
  // meant to establish the county, and the constituency reads inside it.
  Cesium.Cartesian3.fromDegrees(37.02909, -0.80716, 0),
  48000,
);

/**
 * Viewing distance for the settled Murang'a shot.
 *
 * Murang'a is roughly 95 km across. At the old 34,000 m only ~24 km of ground
 * was visible — that framed Kandara constituency, not the county, so the
 * county outline ran off every edge. 150,000 m shows ~105 km, which fits the
 * county with a margin and keeps the neighbouring counties in view (the
 * counties layer stays on down to 42 km).
 */
export const KANDARA_RANGE_M = 150000;

/**
 * MINIMUM dwell on the Kenya-wide view (ms).
 *
 * A minimum, not a fixed duration: at 2,200 km the imagery pyramid needs a few
 * seconds to resolve, and a fixed 3.5s hold showed the country as a featureless
 * blur and then left — which is worse than not stopping at all, because the one
 * moment meant to say "this is Kenya" says nothing.
 */
export const KENYA_HOLD_MS = 3500;

/**
 * Hard cap on waiting for tiles before descending anyway (ms).
 *
 * On a slow connection the globe may never fully settle. The opening must not
 * stall forever waiting for perfection — past this we move on and let the
 * imagery sharpen wherever the camera ends up.
 */
export const KENYA_HOLD_MAX_MS = 11000;

/**
 * Default startup flight, in three beats:
 *
 *   1. Snap to a vantage point out in space, straight down over Kenya.
 *   2. Fly in and SETTLE on the whole of Kenya — held for KENYA_HOLD_MS so the
 *      national layer is actually readable, not a frame smeared through on the
 *      way somewhere else.
 *   3. Only then descend to Murang'a county / the Kandara area (lat -0.85,
 *      lon 36.95) — the heart of the "Nielekeze by TerraMavuno" farmer journey.
 *
 * The descent is abandoned if the user grabs the camera first: an opening
 * animation should never fight someone who has started exploring. Cancelling
 * leaves the camera wherever it currently is.
 *
 * @param {object} viewer Cesium viewer.
 * @param {{onStage?: (stage: 'kenya'|'muranga') => void, holdMs?: number,
 *          drillDown?: boolean}} [options]
 *   onStage   - notified as each beat BEGINS (useful for loader copy).
 *   holdMs    - override the Kenya-wide dwell.
 *   drillDown - set false to stop at the Kenya-wide view.
 * @returns {{cancel: () => void, done: Promise<'kenya'|'muranga'>}}
 *   `done` resolves with the last stage actually reached.
 */
export function flyToKenya(viewer, options = {}) {
  const { onStage, holdMs = KENYA_HOLD_MS, drillDown = true } = options;

  let cancelled = false;
  let holdTimer = null;
  let resolveDone;
  const done = new Promise((resolve) => {
    resolveDone = resolve;
  });

  const stage = (name) => {
    try {
      onStage?.(name);
    } catch {
      // A caller's status-copy handler must never break the flight.
    }
  };

  const cancel = () => {
    if (cancelled) return;
    cancelled = true;
    if (holdTimer !== null) clearTimeout(holdTimer);
    holdTimer = null;
    detachUserOverride();
    viewer.camera.cancelFlight();
    resolveDone('kenya');
  };

  // Any real camera input from the user retires the scripted flight.
  const handler = new Cesium.ScreenSpaceEventHandler(viewer.canvas);
  const overrideTypes = [
    Cesium.ScreenSpaceEventType.LEFT_DOWN,
    Cesium.ScreenSpaceEventType.RIGHT_DOWN,
    Cesium.ScreenSpaceEventType.MIDDLE_DOWN,
    Cesium.ScreenSpaceEventType.WHEEL,
    Cesium.ScreenSpaceEventType.PINCH_START,
  ];
  function detachUserOverride() {
    if (!handler.isDestroyed()) handler.destroy();
  }
  for (const type of overrideTypes) handler.setInputAction(() => cancel(), type);

  // Beat 1 — out in space, looking straight down at Kenya.
  viewer.camera.setView({
    destination: Cesium.Cartesian3.fromDegrees(37.9, 0.4, 4200000),
    orientation: {
      heading: Cesium.Math.toRadians(0),
      pitch: Cesium.Math.toRadians(-90),
      roll: 0.0,
    },
  });

  // Beat 2 — settle on the whole country.
  stage('kenya');
  viewer.camera.flyTo({
    destination: KENYA_OVERVIEW.destination,
    orientation: KENYA_OVERVIEW.orientation,
    duration: 3.0,
    easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
    complete: () => {
      if (cancelled) return;
      if (!drillDown) {
        detachUserOverride();
        resolveDone('kenya');
        return;
      }

      // Beat 3 — hold on Kenya until it is actually LEGIBLE, then descend.
      //
      // We wait for the minimum dwell AND for Cesium to report its tiles
      // loaded, whichever is later, capped so a slow link cannot stall the
      // opening. Polling `globe.tilesLoaded` is the only honest signal here:
      // the camera arriving is not the same thing as the country being drawn.
      const holdStartedAt = Date.now();
      const descend = () => {
        holdTimer = null;
        if (cancelled) return;
        const elapsed = Date.now() - holdStartedAt;
        const settled = viewer.scene.globe.tilesLoaded === true;
        if ((!settled || elapsed < holdMs) && elapsed < KENYA_HOLD_MAX_MS) {
          // Keep the frame coming while we wait, or a render-on-demand scene
          // will never load the tiles we are waiting for.
          viewer.scene.requestRender();
          holdTimer = setTimeout(descend, 250);
          return;
        }
        stage('muranga');
        // flyToBoundingSphere, NOT flyTo(destination): a tilted flyTo puts the
        // camera AT the coordinate and looks off into the distance, which left
        // Kandara sliding off the bottom of the scope. A bounding sphere is
        // framed — Cesium solves for a camera that keeps the whole sphere
        // centred at the requested tilt, so the wards land mid-screen at any
        // pitch or viewport aspect.
        viewer.camera.flyToBoundingSphere(KANDARA_EXTENT, {
          offset: new Cesium.HeadingPitchRange(
            Cesium.Math.toRadians(10),
            Cesium.Math.toRadians(-62),
            KANDARA_RANGE_M,
          ),
          duration: 4.5,
          easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
          complete: () => {
            if (cancelled) return;
            detachUserOverride();
            resolveDone('muranga');
          },
          cancel: () => cancel(),
        });
      };
      holdTimer = setTimeout(descend, 250);
    },
    cancel: () => cancel(),
  });

  return { cancel, done };
}
