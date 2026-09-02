import * as Cesium from 'cesium';

/**
 * Per-layer data attribution registered into Cesium's credit display.
 *
 * TerraMavuno fork: every GEV live-feed and bundled-dataset credit was removed
 * along with its layer. What remains is attribution for the Kenya demo data:
 * Natural Earth (public domain, kept from GEV), kenya-locations (MIT,
 * names/codes), geoBoundaries/HDX ward geometry, and the clearly-labeled
 * synthetic (SIMULATED) demo entities. Basemap credits (Google, Cesium ion,
 * Esri, OSM) are added by Cesium itself per active imagery provider.
 *
 * Credits are registered ONCE at init as STATIC credits with
 * showOnScreen=false, so they live in the expandable bottom-left
 * "Data attribution" lightbox rather than cluttering the on-globe line.
 */

/**
 * Attribution entries. `html` is the credit markup; keep it minimal and
 * link out to the canonical URL.
 * @type {{ key: string, html: string }[]}
 */
export const DATA_CREDITS = [
  {
    key: 'kenya-locations',
    html:
      'Kenya county/constituency/ward names &amp; codes: ' +
      '<a href="https://github.com/michaelnjuguna/kenya-locations" target="_blank" rel="noopener">kenya-locations</a> ' +
      '(MIT)',
  },
  {
    key: 'geoboundaries',
    html:
      'Administrative boundaries: ' +
      '<a href="https://www.geoboundaries.org" target="_blank" rel="noopener">geoBoundaries</a> ' +
      '(CC BY 4.0) / IEBC ward boundaries via ' +
      '<a href="https://data.humdata.org" target="_blank" rel="noopener">HDX</a>',
  },
  {
    key: 'moald',
    html:
      'Subsidy programme rules &amp; prices: Ministry of Agriculture and Livestock ' +
      'Development (MoALD) circulars / Kenya Gazette notices, as cited per fact',
  },
  {
    key: 'simulated-demo-data',
    html:
      'Farmer tokens and agro-dealer depots marked SIMULATED are synthetic ' +
      'demo data — no real personal data is used',
  },
];

/** Registered when the first Natural Earth region outline resolves (public
 * domain — no attribution required; credited as a courtesy). */
export const NATURAL_EARTH_CREDIT = {
  key: 'natural-earth',
  html:
    'Physical region boundaries from ' +
    '<a href="https://www.naturalearthdata.com" target="_blank" rel="noopener">Natural Earth</a> (public domain)',
};

/** @type {Set<string>} Keys of dynamic credits already registered this session. */
const _dynamicCreditKeys = new Set();

/**
 * Register a conditional credit at the moment its data source activates.
 * Idempotent per `credit.key`; lands in the same "Data attribution" popover
 * as the static credits (showOnScreen=false).
 * @param {Cesium.Viewer} viewer — the initialized Cesium viewer
 * @param {{ key: string, html: string }} credit — e.g. `NATURAL_EARTH_CREDIT`
 * @returns {boolean} True when the credit is (now) registered.
 */
export function registerDynamicCredit(viewer, credit) {
  const creditDisplay = viewer?.creditDisplay;
  if (!creditDisplay || typeof creditDisplay.addStaticCredit !== 'function') {
    return false;
  }
  if (!credit?.key || !credit?.html) return false;
  if (_dynamicCreditKeys.has(credit.key)) return true;
  creditDisplay.addStaticCredit(new Cesium.Credit(credit.html, false));
  _dynamicCreditKeys.add(credit.key);
  return true;
}

/**
 * Register every per-layer data credit into the viewer's credit display.
 * Idempotent: safe to call once at init. Credits are static and always
 * present in the "Data attribution" popover.
 * @param {Cesium.Viewer} viewer — the initialized Cesium viewer
 */
export function registerDataCredits(viewer) {
  const creditDisplay = viewer?.creditDisplay;
  if (!creditDisplay || typeof creditDisplay.addStaticCredit !== 'function') {
    return;
  }
  for (const { html } of DATA_CREDITS) {
    // showOnScreen=false → lives in the expandable "Data attribution" popover,
    // not the on-globe credit line.
    creditDisplay.addStaticCredit(new Cesium.Credit(html, false));
  }
}
