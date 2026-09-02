/**
 * Canonical TerraMavuno demo data — the single source of truth shared by the engine
 * tests, the bundled-JSON fallback and the Supabase seed. All farmer tokens are
 * SYNTHETIC (K-001 style); no real personal data. Depots other than NCPB Sagana are
 * SIMULATED and tagged as such in their evidence.
 *
 * Ward codes come from the MIT-licensed kenya-locations dataset (Murang'a county 021,
 * Kandara constituency 109). Ward centroids are approximate demo coordinates near
 * Kandara (~ -0.85, 36.95), kept ~0.03 deg apart.
 */
import type {
  Depot,
  EvidenceTag,
  FarmerToken,
  PriceRow,
  ProgrammeRules,
  WardCentroid,
} from './types.js';

const CIRCULAR_EVIDENCE: EvidenceTag = {
  authority: 'official',
  derivation: 'direct',
  freshness: { checkedAt: '2026-08-14T00:00:00Z', status: 'current' },
  sourceId: 'moald-subsidy-circular-2026',
  citation:
    'MoALD subsidy circular — National Fertilizer Subsidy Programme, 2026 Long Rains, effective 2026-08-14',
};

/** Approximate ward centroids for the 6 Kandara wards, keyed by ward NAME. */
export const KANDARA_WARD_CENTROIDS: Record<string, WardCentroid> = {
  "Ng'araria": { wardCode: '0539', lat: -0.82, lon: 36.93 },
  Muruka: { wardCode: '0540', lat: -0.85, lon: 36.96 },
  'Kagundu-ini': { wardCode: '0541', lat: -0.91, lon: 36.94 },
  Gaichanjiru: { wardCode: '0542', lat: -0.88, lon: 36.99 },
  Ithiru: { wardCode: '0543', lat: -0.79, lon: 36.97 },
  Ruchu: { wardCode: '0544', lat: -0.94, lon: 37.0 },
};

export const PROGRAMME: ProgrammeRules = {
  id: 'ken-fert-subsidy-2026',
  name: 'National Fertilizer Subsidy Programme',
  season: '2026 Long Rains',
  participatingWards: ["Ng'araria", 'Muruka', 'Kagundu-ini', 'Gaichanjiru', 'Ithiru', 'Ruchu'],
  criteria: [
    {
      id: 'in_register',
      label: 'Appears in the Kenya Farmer Register',
      test: 'in_register',
      evidence: {
        ...CIRCULAR_EVIDENCE,
        citation: `${CIRCULAR_EVIDENCE.citation} — registration requirement (sec. 2a)`,
      },
    },
    {
      id: 'id_linked',
      label: 'National ID linked to register entry',
      test: 'id_linked',
      evidence: {
        ...CIRCULAR_EVIDENCE,
        citation: `${CIRCULAR_EVIDENCE.citation} — ID-linkage requirement (sec. 2b)`,
      },
    },
    {
      id: 'acreage_max',
      label: 'Farm size within the 5-acre cap',
      test: 'acreage_max',
      param: 5,
      evidence: {
        ...CIRCULAR_EVIDENCE,
        citation: `${CIRCULAR_EVIDENCE.citation} — smallholder acreage cap (sec. 2c)`,
      },
    },
    {
      id: 'ward_participating',
      label: 'Ward is on the participating list',
      test: 'ward_participating',
      evidence: {
        ...CIRCULAR_EVIDENCE,
        citation: `${CIRCULAR_EVIDENCE.citation} — participating wards annex`,
      },
    },
    {
      id: 'stock_available',
      label: 'Stock available at the assigned depot',
      test: 'stock_available',
      evidence: {
        ...CIRCULAR_EVIDENCE,
        citation: `${CIRCULAR_EVIDENCE.citation} — redemption subject to depot stock (sec. 4)`,
      },
    },
  ],
  allocationFormula: { bagsPerAcre: 2, maxBags: 10 },
  evidence: CIRCULAR_EVIDENCE,
  wardCentroids: KANDARA_WARD_CENTROIDS,
};

export const PRICES: PriceRow[] = [
  {
    inputType: 'planting_fertilizer',
    subsidizedPriceKes: 2500,
    marketPriceKes: 6500,
    bagWeightKg: 50,
    validFrom: '2026-08-14T00:00:00Z',
    validTo: '2026-12-31T23:59:59Z',
    evidence: {
      authority: 'official',
      derivation: 'direct',
      freshness: { checkedAt: '2026-08-14T00:00:00Z', status: 'current' },
      sourceId: 'kenya-gazette-price-notice-2026',
      citation:
        'Kenya Gazette price notice — subsidized planting fertilizer, KES 2,500 per 50 kg bag (market ~KES 6,500), valid 2026-08-14 to 2026-12-31',
    },
  },
];

export const DEPOTS: Depot[] = [
  {
    id: 'ncpb-sagana',
    name: 'NCPB Sagana Depot',
    lat: -0.66,
    lon: 37.2,
    merchant: 'National Cereals and Produce Board',
    assetType: 'ncpb_depot',
    stockStatus: 'in_stock',
    checkedAt: '2026-09-02T06:00:00Z',
    classification: 'official',
    evidence: {
      authority: 'official',
      derivation: 'direct',
      freshness: { checkedAt: '2026-09-02T06:00:00Z', status: 'current' },
      sourceId: 'ncpb-depot-register',
      citation: 'NCPB depot register — Sagana Depot stock report, checked 2026-09-02 06:00 UTC',
    },
  },
  {
    id: 'kabati-agrovet',
    name: 'Kabati Agrovet',
    lat: -0.9,
    lon: 36.98,
    merchant: 'Kabati Agrovet Ltd (SIMULATED)',
    assetType: 'agro_dealer',
    stockStatus: 'unknown',
    checkedAt: null,
    classification: 'simulated',
    evidence: {
      authority: 'reported',
      derivation: 'simulated',
      freshness: { checkedAt: null, status: 'unknown' },
      sourceId: 'simulated-depot-kabati',
      citation: 'SIMULATED agro-dealer for demo — Kabati Agrovet; no verified stock feed',
    },
  },
  {
    id: 'kagunduini-supplies',
    name: 'Kagundu-ini Farm Supplies',
    lat: -0.93,
    lon: 36.94,
    merchant: 'Kagundu-ini Farm Supplies (SIMULATED)',
    assetType: 'agro_dealer',
    stockStatus: 'low',
    checkedAt: '2026-09-01T14:00:00Z',
    classification: 'simulated',
    evidence: {
      authority: 'reported',
      derivation: 'simulated',
      freshness: { checkedAt: '2026-09-01T14:00:00Z', status: 'current' },
      sourceId: 'simulated-depot-kagunduini',
      citation:
        'SIMULATED agro-dealer for demo — Kagundu-ini Farm Supplies; stock self-reported 2026-09-01 14:00 UTC',
    },
  },
  {
    id: 'kenol-agro',
    name: 'Kenol Agro Centre',
    lat: -0.99,
    lon: 37.12,
    merchant: 'Kenol Agro Centre (SIMULATED)',
    assetType: 'agro_dealer',
    stockStatus: 'in_stock',
    checkedAt: '2026-09-02T05:30:00Z',
    classification: 'simulated',
    evidence: {
      authority: 'reported',
      derivation: 'simulated',
      freshness: { checkedAt: '2026-09-02T05:30:00Z', status: 'current' },
      sourceId: 'simulated-depot-kenol',
      citation:
        'SIMULATED agro-dealer for demo — Kenol Agro Centre; stock self-reported 2026-09-02 05:30 UTC',
    },
  },
];

/** Four synthetic tokens, one per demo state. K-004 is the deliberate sijui case. */
export const FARMERS: FarmerToken[] = [
  {
    token: 'K-001',
    wardCode: '0539',
    wardName: "Ng'araria",
    state: 'registered',
    assignedDepotId: 'ncpb-sagana',
    attributes: {
      inFarmerRegister: true,
      nationalIdLinked: true,
      acreage: 2,
      crop: 'maize',
      priorRedemptions: 0,
    },
  },
  {
    token: 'K-002',
    wardCode: '0540',
    wardName: 'Muruka',
    state: 'missing_requirement',
    attributes: {
      inFarmerRegister: true,
      nationalIdLinked: false,
      acreage: 1.5,
      crop: 'maize',
      priorRedemptions: 0,
    },
  },
  {
    token: 'K-003',
    wardCode: '0542',
    wardName: 'Gaichanjiru',
    state: 'ineligible',
    attributes: {
      inFarmerRegister: true,
      nationalIdLinked: true,
      acreage: 7.5,
      crop: 'maize',
      priorRedemptions: 0,
    },
  },
  {
    token: 'K-004',
    wardCode: '0543',
    wardName: 'Ithiru',
    state: 'registered',
    assignedDepotId: 'kabati-agrovet',
    attributes: {
      inFarmerRegister: true,
      nationalIdLinked: true,
      acreage: 3,
      crop: 'maize',
      priorRedemptions: 0,
    },
  },
];

/** Fixed "now" for reproducible demos and tests (never call Date.now() in the engine). */
export const DEMO_NOW = '2026-09-02T09:00:00Z';
