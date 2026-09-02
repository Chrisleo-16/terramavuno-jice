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
  kenya: {
    destination: Cesium.Cartesian3.fromDegrees(37.9, 0.2, 1500000),
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
  Cesium.Cartesian3.fromDegrees(36.95, -0.85, 0),
  16000,
);

/** Viewing distance for the settled Murang'a shot. */
export const KANDARA_RANGE_M = 34000;

/** How long the camera holds on the Kenya-wide view before drilling in (ms). */
export const KENYA_HOLD_MS = 3500;

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
    destination: Cesium.Cartesian3.fromDegrees(37.9, 0.2, 2500000),
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

      // Beat 3 — hold on Kenya, then descend to Murang'a.
      holdTimer = setTimeout(() => {
        holdTimer = null;
        if (cancelled) return;
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
            Cesium.Math.toRadians(-52),
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
      }, holdMs);
    },
    cancel: () => cancel(),
  });

  return { cancel, done };
}
