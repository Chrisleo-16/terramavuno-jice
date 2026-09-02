/**
 * @module data/kilimo/kilimoData
 * @description Bundled, zero-network Kenya demo data for the five Kilimo map
 * layers (wards, programme, prices, depots, farmers).
 *
 * WHY A LOCAL COPY: `apps/globe` deliberately does not depend on
 * `@terramavuno/shared` (that package is TypeScript and server-shaped), and the
 * demo must render with the network unplugged. The programme/price/farmer
 * constants here therefore MIRROR
 * `packages/shared/src/data/kilimo-fallback.json` — the canonical demo values
 * agreed across agents. Geometry and depots are read from the committed files
 * under `src/data/local_data/kenya/`, so there is exactly one copy of those.
 *
 * If a canonical value changes, change it in the fallback JSON first and mirror
 * it here; `checkKilimoDataConsistency()` (below) is the cheap guard that the
 * mirrored headline numbers still match what the engine will decide.
 */

import depotsFile from '../local_data/kenya/depots.muranga.json';
import centroidsFile from '../local_data/kenya/centroids.json';
// Unknown-extension imports resolve to an asset URL under Vite, so the ward and
// county geometry stays out of the main bundle and is fetched on first enable.
import wardsGeojsonUrl from '../local_data/kenya/muranga_wards.geojson';
import countiesGeojsonUrl from '../local_data/kenya/counties.geojson';

/** Murang'a county code (KNBS/IEBC). */
export const COUNTY_CODE = '021';
/** Murang'a county name, as written in every citation. */
export const COUNTY_NAME = "Murang'a";
/** The constituency the P0 farmer journey happens in. */
export const CONSTITUENCY_NAME = 'Kandara';

const CIRCULAR_EVIDENCE = Object.freeze({
  authority: 'official',
  derivation: 'direct',
  freshness: Object.freeze({ checkedAt: '2026-08-14T00:00:00Z', status: 'current' }),
  sourceId: 'moald-subsidy-circular-2026',
  citation: 'MoALD subsidy circular — National Fertilizer Subsidy Programme, 2026 Long Rains, effective 2026-08-14',
});

/**
 * Build one criterion evidence tag from the shared circular tag, with the
 * clause-level citation the fallback JSON carries.
 * @param {string} clause Clause suffix, e.g. 'registration requirement (sec. 2a)'.
 * @returns {object} EvidenceTag
 */
function circularEvidence(clause) {
  return Object.freeze({
    ...CIRCULAR_EVIDENCE,
    citation: `${CIRCULAR_EVIDENCE.citation} — ${clause}`,
  });
}

/** The programme, mirroring kilimo-fallback.json `programme`. */
export const PROGRAMME = Object.freeze({
  id: 'ken-fert-subsidy-2026',
  name: 'National Fertilizer Subsidy Programme',
  season: '2026 Long Rains',
  authority: 'official',
  source: 'MoALD subsidy circular',
  effectiveFrom: '2026-08-14',
  participatingWards: Object.freeze(["Ng'araria", 'Muruka', 'Kagundu-ini', 'Gaichanjiru', 'Ithiru', 'Ruchu']),
  participatingWardCodes: Object.freeze(['0539', '0540', '0541', '0542', '0543', '0544']),
  criteria: Object.freeze([
    {
      id: 'in_register',
      label: 'Appears in the Kenya Farmer Register',
      test: 'in_register',
      evidence: circularEvidence('registration requirement (sec. 2a)'),
    },
    {
      id: 'id_linked',
      label: 'National ID linked to register entry',
      test: 'id_linked',
      evidence: circularEvidence('ID-linkage requirement (sec. 2b)'),
    },
    {
      id: 'acreage_max',
      label: 'Farm size within the 5-acre cap',
      test: 'acreage_max',
      param: 5,
      evidence: circularEvidence('smallholder acreage cap (sec. 2c)'),
    },
    {
      id: 'ward_participating',
      label: 'Ward is on the participating list',
      test: 'ward_participating',
      evidence: circularEvidence('participating wards annex'),
    },
    {
      id: 'stock_available',
      label: 'Stock available at the assigned depot',
      test: 'stock_available',
      evidence: circularEvidence('redemption subject to depot stock (sec. 4)'),
    },
  ]),
  allocationFormula: Object.freeze({ bagsPerAcre: 2, maxBags: 10 }),
  evidence: CIRCULAR_EVIDENCE,
});

/** The active price row, mirroring kilimo-fallback.json `prices[0]`. */
export const PRICE_ROW = Object.freeze({
  inputType: 'planting_fertilizer',
  subsidizedPriceKes: 2500,
  marketPriceKes: 6500,
  bagWeightKg: 50,
  validFrom: '2026-08-14T00:00:00Z',
  validTo: '2026-12-31T23:59:59Z',
  evidence: Object.freeze({
    authority: 'official',
    derivation: 'direct',
    freshness: Object.freeze({ checkedAt: '2026-08-14T00:00:00Z', status: 'current' }),
    sourceId: 'kenya-gazette-price-notice-2026',
    citation: 'Kenya Gazette price notice — subsidized planting fertilizer, KES 2,500 per 50 kg bag (market ~KES 6,500), valid 2026-08-14 to 2026-12-31',
  }),
});

const SIMULATED_FARMER_EVIDENCE = Object.freeze({
  authority: 'reported',
  derivation: 'simulated',
  freshness: Object.freeze({ checkedAt: '2026-09-02T00:00:00Z', status: 'current' }),
  sourceId: 'simulated-farmer-tokens',
  citation: 'SIMULATED farmer token (demo seed) — synthetic record, no real personal data',
});

/**
 * The synthetic farmer tokens. NO REAL PERSONAL DATA: these are demo tokens
 * (K-001 … K-005), each one archetype of an engine conclusion. Mirrors
 * kilimo-fallback.json `farmers`.
 *
 * `expectedConclusion` is the DEMO EXPECTATION only — the deterministic engine
 * in packages/shared decides the real one; these layers never compute it.
 */
export const FARMERS = Object.freeze([
  {
    token: 'K-001',
    wardCode: '0539',
    wardName: "Ng'araria",
    state: 'registered',
    assignedDepotId: 'ncpb-sagana',
    expectedConclusion: 'confirmed',
    attributes: { inFarmerRegister: true, nationalIdLinked: true, acreage: 2, crop: 'maize', priorRedemptions: 0 },
    evidence: SIMULATED_FARMER_EVIDENCE,
  },
  {
    token: 'K-002',
    wardCode: '0540',
    wardName: 'Muruka',
    state: 'missing_requirement',
    assignedDepotId: 'kabati-agrovet',
    expectedConclusion: 'confirmed',
    attributes: { inFarmerRegister: true, nationalIdLinked: false, acreage: 1.5, crop: 'maize', priorRedemptions: 0 },
    evidence: SIMULATED_FARMER_EVIDENCE,
  },
  {
    token: 'K-003',
    wardCode: '0542',
    wardName: 'Gaichanjiru',
    state: 'ineligible',
    assignedDepotId: 'kabati-agrovet',
    expectedConclusion: 'confirmed',
    attributes: { inFarmerRegister: true, nationalIdLinked: true, acreage: 7.5, crop: 'maize', priorRedemptions: 0 },
    evidence: SIMULATED_FARMER_EVIDENCE,
  },
  {
    token: 'K-004',
    wardCode: '0543',
    wardName: 'Ithiru',
    state: 'registered',
    assignedDepotId: 'kabati-agrovet',
    expectedConclusion: 'indicated_by_published_rules',
    attributes: { inFarmerRegister: true, nationalIdLinked: true, acreage: 3, crop: 'maize', priorRedemptions: 0 },
    evidence: SIMULATED_FARMER_EVIDENCE,
  },
  {
    token: 'K-005',
    wardCode: '0544',
    wardName: 'Ruchu',
    state: 'unknown',
    assignedDepotId: 'kenol-agro',
    expectedConclusion: 'cannot_determine',
    attributes: { inFarmerRegister: 'unknown', nationalIdLinked: true, acreage: 2.5, crop: 'maize', priorRedemptions: 0 },
    evidence: Object.freeze({
      ...SIMULATED_FARMER_EVIDENCE,
      freshness: Object.freeze({ checkedAt: null, status: 'unknown' }),
    }),
  },
]);

/** The exact honest-uncertainty sentence for the K-004 case. Never reworded. */
export const SIJUI_SENTENCE = 'Rules indicate you qualify, but I cannot verify today’s stock at this depot.';

/** Depots (1 cited NCPB facility + 3 SIMULATED agro-dealers). */
export const DEPOTS = Object.freeze(depotsFile.depots.map((depot) => Object.freeze({ ...depot })));

/** Calculated ward centroids for the six Kandara wards. */
export const WARD_CENTROIDS = Object.freeze(centroidsFile.wards.map((ward) => Object.freeze({ ...ward })));

/** Calculated county centroid(s) — Murang'a only in this fork. */
export const COUNTY_CENTROIDS = Object.freeze(centroidsFile.counties.map((county) => Object.freeze({ ...county })));

/** Murang'a county centroid, the anchor for the programme/price cards. */
export const COUNTY_CENTROID = COUNTY_CENTROIDS.find((county) => county.code === COUNTY_CODE)
  || Object.freeze({ code: COUNTY_CODE, name: COUNTY_NAME, lat: -0.80716, lon: 37.02909 });

/** Approximate centre of the Kandara constituency (mean of its ward centroids). */
export const KANDARA_CENTROID = Object.freeze({
  name: CONSTITUENCY_NAME,
  lat: WARD_CENTROIDS.reduce((sum, ward) => sum + ward.lat, 0) / (WARD_CENTROIDS.length || 1),
  lon: WARD_CENTROIDS.reduce((sum, ward) => sum + ward.lon, 0) / (WARD_CENTROIDS.length || 1),
});

/** Geometry-derived evidence: centroids are CALCULATED, never official points. */
export const CENTROID_EVIDENCE = Object.freeze({
  authority: 'official',
  derivation: 'calculated',
  freshness: Object.freeze({ checkedAt: '2026-09-02T00:00:00Z', status: 'current' }),
  sourceId: 'geoboundaries-ken-adm3',
  citation: 'Centroid calculated from geoBoundaries gbOpen KEN ADM3 (IEBC-derived) ward polygons — labels and camera framing only',
});

/** Evidence for the ward polygons themselves. */
export const WARD_GEOMETRY_EVIDENCE = Object.freeze({
  authority: 'official',
  derivation: 'direct',
  freshness: Object.freeze({ checkedAt: '2026-09-02T00:00:00Z', status: 'current' }),
  sourceId: 'geoboundaries-ken-adm3',
  citation: 'geoBoundaries gbOpen KEN ADM3 (IEBC-derived) ward boundaries — CC BY 4.0 citation requested',
});

/**
 * Evidence for a ward whose polygon is flagged `properties.approximate`.
 * Approximate geometry is NEVER presented as an official boundary.
 */
export const APPROXIMATE_GEOMETRY_EVIDENCE = Object.freeze({
  authority: 'reported',
  derivation: 'inferred',
  freshness: Object.freeze({ checkedAt: '2026-09-02T00:00:00Z', status: 'unknown' }),
  sourceId: 'geoboundaries-ken-adm3-approximate',
  citation: 'Approximate boundary — geometry reconstructed or simplified, NOT an official gazetted boundary',
});

/** Evidence for the county outline. */
export const COUNTY_GEOMETRY_EVIDENCE = Object.freeze({
  authority: 'official',
  derivation: 'direct',
  freshness: Object.freeze({ checkedAt: '2026-09-02T00:00:00Z', status: 'current' }),
  sourceId: 'geoboundaries-ken-adm1',
  citation: 'geoBoundaries gbOpen KEN ADM1 (RCMRD GeoPortal) county boundaries — CC BY 4.0 citation requested',
});

/**
 * Allocation for an acreage under the programme formula. Always report this as
 * DERIVATION 'calculated' — arithmetic on published rules, not a fact anyone
 * has confirmed for a given farmer.
 * @param {number|null} acreage Acres, or null when unknown.
 * @returns {number|null} Whole bags, or null when acreage is unknown.
 */
export function allocationBagsFor(acreage) {
  // `Number(null)` is 0, so an unknown acreage must be rejected BEFORE the
  // numeric test — otherwise "we do not know" would render as "0 bags".
  if (acreage === null || acreage === undefined || acreage === '') return null;
  if (!Number.isFinite(Number(acreage))) return null;
  const { bagsPerAcre, maxBags } = PROGRAMME.allocationFormula;
  return Math.min(Math.floor(Number(acreage) * bagsPerAcre), maxBags);
}

/**
 * Per-bag saving between the market reference and the subsidized price.
 * @returns {number} KES per 50 kg bag (calculated).
 */
export function savingsPerBagKes() {
  return PRICE_ROW.marketPriceKes - PRICE_ROW.subsidizedPriceKes;
}

/**
 * Format a KES amount as `KES 2,500`.
 * @param {number|null} value
 * @returns {string}
 */
export function formatKes(value) {
  if (!Number.isFinite(Number(value))) return 'KES —';
  return `KES ${Number(value).toLocaleString('en-KE')}`;
}

/**
 * ISO timestamp to `2026-08-14` (date only).
 * @param {string|null} value
 * @returns {string} Empty string for null/invalid input.
 */
export function isoDate(value) {
  if (!value) return '';
  const match = String(value).match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : '';
}

/**
 * ISO timestamp to `2026-09-02 06:00 UTC`.
 * @param {string|null} value
 * @returns {string} Empty string for null/invalid input.
 */
export function isoMinuteUtc(value) {
  if (!value) return '';
  const match = String(value).match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
  return match ? `${match[1]} ${match[2]} UTC` : isoDate(value);
}

let _wardFeaturePromise = null;
let _countyFeaturePromise = null;

/**
 * Fetch the Kandara ward features (plus every Murang'a ward, for context).
 * Cached, so a second enable() of the ward layer costs nothing; a failure
 * clears the cache so the next enable() genuinely retries.
 * @returns {Promise<{kandara: object[], county: object[]}>}
 */
export function loadWardFeatures() {
  if (!_wardFeaturePromise) {
    _wardFeaturePromise = fetch(wardsGeojsonUrl)
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then((collection) => {
        const features = Array.isArray(collection?.features) ? collection.features : [];
        const county = features.filter((feature) => feature?.properties?.countyCode === COUNTY_CODE);
        const kandara = county.filter((feature) => feature?.properties?.constituency === CONSTITUENCY_NAME);
        return { kandara, county };
      })
      .catch((error) => {
        _wardFeaturePromise = null;
        throw error;
      });
  }
  return _wardFeaturePromise;
}

/**
 * Fetch the Murang'a county outline feature.
 * @returns {Promise<object|null>}
 */
/** @type {Promise<object[]>|null} */
let _allCountiesPromise = null;

/**
 * Every Kenyan county boundary (all 47), for the national view.
 *
 * `loadCountyFeature` deliberately returns only Murang'a, which is why the
 * globe showed a bare basemap at country zoom: the geometry for the other 46
 * was sitting in the same file, unread.
 *
 * @returns {Promise<object[]>} GeoJSON features; empty array on failure, since
 *   a missing national outline must degrade to "no borders", never to a crash.
 */
export function loadAllCountyFeatures() {
  if (!_allCountiesPromise) {
    _allCountiesPromise = fetch(countiesGeojsonUrl)
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then((collection) => (Array.isArray(collection?.features) ? collection.features : []))
      .catch((error) => {
        _allCountiesPromise = null;
        console.warn('[Kilimo] national county boundaries unavailable:', error?.message ?? error);
        return [];
      });
  }
  return _allCountiesPromise;
}

export function loadCountyFeature() {
  if (!_countyFeaturePromise) {
    _countyFeaturePromise = fetch(countiesGeojsonUrl)
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then((collection) => (Array.isArray(collection?.features)
        ? collection.features.find((feature) => feature?.properties?.code === COUNTY_CODE) || null
        : null))
      .catch((error) => {
        _countyFeaturePromise = null;
        throw error;
      });
  }
  return _countyFeaturePromise;
}

/**
 * Look up a depot record by id.
 * @param {string} id Depot id, e.g. 'ncpb-sagana'.
 * @returns {object|null}
 */
export function depotById(id) {
  if (!id) return null;
  return DEPOTS.find((depot) => depot.id === id) || null;
}

/**
 * Look up a ward centroid by ward NAME (exact, as written in the register).
 * @param {string} name
 * @returns {object|null}
 */
export function wardCentroidByName(name) {
  if (!name) return null;
  return WARD_CENTROIDS.find((ward) => ward.name === name) || null;
}

/**
 * Cheap self-check that the mirrored constants still agree with the canonical
 * demo values every other agent codes against. Returns the disagreements
 * (empty when consistent) instead of throwing, so drift shows up as a console
 * warning rather than a dead globe.
 * @returns {string[]} Human-readable problems.
 */
export function checkKilimoDataConsistency() {
  const problems = [];
  if (PROGRAMME.id !== 'ken-fert-subsidy-2026') problems.push('programme id drifted');
  if (PROGRAMME.criteria.length !== 5) problems.push('programme must publish exactly 5 criteria');
  if (PROGRAMME.participatingWards.length !== 6) problems.push('6 Kandara wards expected');
  if (PRICE_ROW.subsidizedPriceKes !== 2500 || PRICE_ROW.marketPriceKes !== 6500) {
    problems.push('price row drifted from KES 2,500 / KES 6,500');
  }
  if (allocationBagsFor(2) !== 4) problems.push('allocation formula drifted (2 acres must be 4 bags)');
  if (allocationBagsFor(9) !== 10) problems.push('allocation cap drifted (must cap at 10 bags)');
  if (DEPOTS.length < 4) problems.push('4 depots expected');
  if (WARD_CENTROIDS.length !== 6) problems.push('6 ward centroids expected');
  const sijuiDepot = depotById('kabati-agrovet');
  if (sijuiDepot?.stockStatus !== 'unknown' || sijuiDepot?.checkedAt !== null) {
    problems.push('kabati-agrovet must stay the unknown-stock (sijui) depot');
  }
  return problems;
}
