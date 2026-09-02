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
 * Default startup flight: orbit in from high above Kenya, then settle over
 * Murang'a county / the Kandara area (lat -0.85, lon 36.95) — the heart of
 * the "Nielekeze by TerraMavuno" farmer journey.
 */
export function flyToKenya(viewer) {
  // Start from a high altitude over Kenya, looking straight down
  viewer.camera.setView({
    destination: Cesium.Cartesian3.fromDegrees(37.9, 0.2, 2500000),
    orientation: {
      heading: Cesium.Math.toRadians(0),
      pitch: Cesium.Math.toRadians(-90),
      roll: 0.0,
    },
  });

  // Cinematic fly-in to the Kandara area of Murang'a after a brief pause
  setTimeout(() => {
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(36.95, -0.85, 30000),
      orientation: {
        heading: Cesium.Math.toRadians(10),
        pitch: Cesium.Math.toRadians(-45),
        roll: 0.0,
      },
      duration: 4.5,
      easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
    });
  }, 500);
}
