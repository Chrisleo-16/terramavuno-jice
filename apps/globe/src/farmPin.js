/**
 * @module farmPin
 * @description "Pin my farm" — lets a farmer mark where they actually are, so
 * a delivery has a destination a driver can reach.
 *
 * WHY THIS EXISTS: without a pin the API falls back to the ward centroid, which
 * is the middle of an administrative polygon, not anybody's farm. The API
 * labels that fallback `routable: false` and every channel says so out loud.
 * This is the affordance that fixes it.
 *
 * Deliberately small and self-contained: arm a mode, take ONE click, drop a
 * marker, publish the coordinate. It does not talk to the API — the chat
 * action runner and the voice agent own that, so a pin can be attached to a
 * booking that does not exist yet.
 *
 * Publishes:
 *   `window.__KILIMO__.farmPin` -> { lat, lon, source: 'pin', accuracyMetres,
 *                                    landmark } | null
 *   CustomEvent `kilimo:farm-pinned` on window with the same detail (null when
 *   the pin is cleared).
 */

import * as Cesium from 'cesium';
import { governorRequestRender } from './renderGovernor.js';

const PIN_ENTITY_ID = 'kilimo-farm-pin';
export const FARM_PINNED_EVENT = 'kilimo:farm-pinned';

/**
 * Kenya's bounding box. Mirrors KENYA_BOUNDS in the shared package — a pin
 * outside it is a misclick on a zoomed-out globe, and the API rejects it, so
 * catching it here saves a round trip and gives instant feedback.
 */
const KENYA = { minLat: -4.9, maxLat: 5.6, minLon: 33.8, maxLon: 42.1 };

/**
 * Install the farm-pin control.
 *
 * @param {object} options
 * @param {Cesium.Viewer} options.viewer
 * @param {HTMLElement|null} [options.button] Toggle button; one is looked up
 *   by id when omitted.
 * @returns {{arm: function(): void, disarm: function(): void,
 *            clear: function(): void, get: function(): object|null,
 *            destroy: function(): void}}
 */
export function installFarmPin({ viewer, button = null } = {}) {
  if (!viewer) throw new TypeError('installFarmPin requires a Cesium viewer');

  const toggle = button ?? document.getElementById('kilimo-pin-farm');
  const statusEl = document.getElementById('kilimo-pin-status');

  /** @type {{lat:number, lon:number, source:'pin', accuracyMetres:null, landmark:string|null}|null} */
  let pin = null;
  let armed = false;

  const dataSource = new Cesium.CustomDataSource('kilimo-farm-pin');
  void viewer.dataSources.add(dataSource);

  const setStatus = (text) => {
    if (statusEl) statusEl.textContent = text;
  };

  const publish = () => {
    if (window.__KILIMO__) window.__KILIMO__.farmPin = pin;
    window.dispatchEvent(new CustomEvent(FARM_PINNED_EVENT, { detail: pin }));
  };

  const render = () => {
    dataSource.entities.removeAll();
    if (pin !== null) {
      dataSource.entities.add({
        id: PIN_ENTITY_ID,
        position: Cesium.Cartesian3.fromDegrees(pin.lon, pin.lat),
        point: {
          pixelSize: 14,
          color: Cesium.Color.fromCssColorString('#34d17b'),
          outlineColor: Cesium.Color.fromCssColorString('#04070d'),
          outlineWidth: 3,
          // Stays visible over terrain rather than sinking into a hillside.
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: {
          text: 'MY FARM',
          font: '600 11px monospace',
          fillColor: Cesium.Color.fromCssColorString('#34d17b'),
          outlineColor: Cesium.Color.fromCssColorString('#04070d'),
          outlineWidth: 3,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cesium.Cartesian2(0, -22),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
    }
    governorRequestRender('farm-pin');
  };

  const setArmed = (next) => {
    armed = next;
    toggle?.classList.toggle('armed', armed);
    toggle?.setAttribute('aria-pressed', String(armed));
    // A crosshair is the only affordance telling the user the next click is
    // special rather than a camera drag.
    viewer.canvas.style.cursor = armed ? 'crosshair' : '';
    if (armed) setStatus('Click your farm on the map');
    else if (pin === null) setStatus('');
  };

  /**
   * Resolve a screen click to a ground coordinate.
   * Prefers the terrain/tileset pick and falls back to the ellipsoid, so a pin
   * lands correctly whether or not photoreal tiles are loaded.
   */
  const pickGround = (position) => {
    const scene = viewer.scene;
    let cartesian = null;
    try {
      if (scene.pickPositionSupported) cartesian = scene.pickPosition(position);
    } catch {
      cartesian = null;
    }
    if (!Cesium.defined(cartesian)) {
      const ray = viewer.camera.getPickRay(position);
      cartesian = ray ? scene.globe.pick(ray, scene) : null;
    }
    if (!Cesium.defined(cartesian)) {
      cartesian = viewer.camera.pickEllipsoid(position, scene.globe.ellipsoid);
    }
    return Cesium.defined(cartesian) ? cartesian : null;
  };

  const handler = new Cesium.ScreenSpaceEventHandler(viewer.canvas);
  handler.setInputAction((movement) => {
    if (!armed) return;
    const cartesian = pickGround(movement.position);
    if (cartesian === null) {
      setStatus('Could not read that point — try again on the land.');
      return;
    }
    const carto = Cesium.Cartographic.fromCartesian(cartesian);
    const lat = Number(Cesium.Math.toDegrees(carto.latitude).toFixed(6));
    const lon = Number(Cesium.Math.toDegrees(carto.longitude).toFixed(6));

    if (lat < KENYA.minLat || lat > KENYA.maxLat || lon < KENYA.minLon || lon > KENYA.maxLon) {
      // Reject here rather than let the API do it: instant feedback, and the
      // farmer keeps pin mode armed so they can just click again.
      setStatus('That point is outside Kenya. Zoom in and click your farm.');
      return;
    }

    pin = { lat, lon, source: 'pin', accuracyMetres: null, landmark: null };
    setArmed(false);
    render();
    publish();
    setStatus(`Pinned ${lat.toFixed(4)}, ${lon.toFixed(4)}`);
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

  toggle?.addEventListener('click', () => {
    if (armed) {
      setArmed(false);
      return;
    }
    if (pin !== null) {
      // Second press with a pin down clears it — one button, two states, no
      // extra chrome in an already busy dock.
      pin = null;
      render();
      publish();
      setStatus('Pin cleared');
      return;
    }
    setArmed(true);
  });

  publish();

  return {
    arm: () => setArmed(true),
    disarm: () => setArmed(false),
    clear: () => {
      pin = null;
      render();
      publish();
      setStatus('');
    },
    get: () => (pin === null ? null : { ...pin }),
    destroy: () => {
      if (!handler.isDestroyed()) handler.destroy();
      viewer.dataSources.remove(dataSource, true);
      viewer.canvas.style.cursor = '';
    },
  };
}
