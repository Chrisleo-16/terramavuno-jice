/**
 * @module data/kilimo/countiesLayer
 * @description Layer 'counties' — all 47 Kenyan county boundaries, for the
 * national view.
 *
 * WHY THIS EXISTS: the opening shot frames the whole country, but the only
 * boundary geometry being drawn was Murang'a and its six Kandara wards. Zoomed
 * out, Kenya had no borders at all — just basemap. The geometry for the other
 * 46 counties was already bundled in `counties.geojson`; nothing was reading
 * it.
 *
 * ZOOM BEHAVIOUR: these outlines are scoped with a distance display condition
 * so they own the national and regional view and then get out of the way. Below
 * ~45 km the ward layer is the subject and 47 county outlines would just be
 * clutter competing with it. Murang'a is drawn brighter than its neighbours —
 * it is the pilot county, and at country zoom the viewer needs to know where to
 * look.
 *
 * TRUTH MODEL: geoBoundaries gbOpen KEN ADM1 (RCMRD GeoPortal), classified
 * official, same as the ward geometry.
 */

import * as Cesium from 'cesium';
import { COUNTY_CODE, COUNTY_NAME, loadAllCountyFeatures } from './kilimoData.js';
import { outlineRings } from './wardLayer.js';
import { defineKilimoLayer } from './layerKit.js';

export const COUNTY_ENTITY_PREFIX = 'kilimo-county:';

/** Accent for the pilot county; neighbours are drawn in a cooler, dimmer tone. */
const PILOT_ACCENT = '#34d17b';
const NEIGHBOUR_ACCENT = '#8fb8c9';

/**
 * Visibility band, in metres of camera distance.
 *
 * Near edge sits just above the ward layer's working altitude so the two never
 * fight for the same frame. Far edge is generous — the outlines should still be
 * there when the camera is out at the opening 1,500 km vantage point.
 */
const NEAR_M = 42_000;
const FAR_M = 9_000_000;

/** Casing under core, same treatment as the ward boundaries. */
const LINE = {
  pilotCore: 3.2,
  pilotCasing: 6.5,
  neighbourCore: 1.8,
  neighbourCasing: 4.2,
};

const CASING_COLOR = Cesium.Color.fromCssColorString('#04070d').withAlpha(0.5);

/**
 * Build the counties layer.
 * @param {object} ctx Shared layer context from registerKilimoLayers.
 * @returns {object} A DataLayerManager-compatible layer module.
 */
export function createCountiesLayer(ctx) {
  /** @type {Cesium.CustomDataSource|null} */
  let dataSource = null;
  let countyCount = 0;

  return defineKilimoLayer({
    id: 'counties',
    label: 'Kenya counties (47)',
    name: 'Counties',
    icon: '🇰🇪',
    source: 'geoBoundaries gbOpen KEN ADM1 (RCMRD GeoPortal)',
    ctx,
    count: () => countyCount,

    onEnable: async (viewer) => {
      const features = await loadAllCountyFeatures();
      countyCount = features.length;
      if (features.length === 0) return;

      dataSource = new Cesium.CustomDataSource('kilimo-counties');

      // One shared condition object would be reused by reference across every
      // entity; Cesium is fine with that, but a fresh one per polyline keeps
      // the entities independent if a caller ever tweaks one.
      const band = () => new Cesium.DistanceDisplayCondition(NEAR_M, FAR_M);

      for (const feature of features) {
        const properties = feature?.properties ?? {};
        const isPilot = properties.code === COUNTY_CODE;
        const accent = isPilot ? PILOT_ACCENT : NEIGHBOUR_ACCENT;
        const color = Cesium.Color.fromCssColorString(accent);
        const coreWidth = isPilot ? LINE.pilotCore : LINE.neighbourCore;
        const casingWidth = isPilot ? LINE.pilotCasing : LINE.neighbourCasing;
        // Neighbours sit back so the pilot county reads first.
        const coreAlpha = isPilot ? 0.95 : 0.55;

        for (const [index, positions] of outlineRings(feature.geometry).entries()) {
          dataSource.entities.add({
            id: `${COUNTY_ENTITY_PREFIX}${String(properties.code)}-casing-${String(index)}`,
            polyline: {
              positions,
              width: casingWidth,
              clampToGround: true,
              distanceDisplayCondition: band(),
              material: new Cesium.ColorMaterialProperty(CASING_COLOR),
            },
          });
          dataSource.entities.add({
            id: `${COUNTY_ENTITY_PREFIX}${String(properties.code)}-${String(index)}`,
            name: String(properties.name ?? 'County'),
            polyline: {
              positions,
              width: coreWidth,
              clampToGround: true,
              distanceDisplayCondition: band(),
              material: new Cesium.ColorMaterialProperty(color.withAlpha(coreAlpha)),
            },
            properties: {
              countyCode: properties.code,
              countyName: properties.name,
              pilot: isPilot,
            },
          });
        }
      }

      await viewer.dataSources.add(dataSource);
      dataSource.show = true;
    },

    onDisable: (viewer) => {
      if (dataSource) {
        viewer.dataSources.remove(dataSource, true);
        dataSource = null;
      }
      return true;
    },

    extra: {
      /** Which county is the pilot — used by copy that should not hardcode it. */
      pilotCountyName: COUNTY_NAME,
      /** Exposed for tests and for anyone tuning the handoff to the ward layer. */
      visibilityBandMetres: Object.freeze({ near: NEAR_M, far: FAR_M }),
    },
  });
}
