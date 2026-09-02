/**
 * TerraMavuno truth-model and eligibility types.
 *
 * Every fact carries an EvidenceTag = Authority x Derivation x Freshness, and every
 * operational answer resolves to one of three Conclusions. The engine (engine.ts)
 * decides; Claude only explains and cites these tags.
 */

/** Who stands behind a fact: an official body, or a report/simulation we cannot officially confirm. */
export type Authority = 'official' | 'reported';

/** How a fact was obtained: read directly, computed, inferred, or fabricated for the demo. */
export type Derivation = 'direct' | 'calculated' | 'inferred' | 'simulated';

/** How fresh an observation is. `checkedAt` is an ISO timestamp or null when never verified. */
export interface Freshness {
  checkedAt: string | null;
  status: 'current' | 'stale' | 'unknown';
}

/** Full provenance tag attached to every fact the engine uses or emits. */
export interface EvidenceTag {
  authority: Authority;
  derivation: Derivation;
  freshness: Freshness;
  sourceId: string;
  citation: string;
}

/** Demo farmer archetypes. 'unknown' = register status itself cannot be determined. */
export type FarmerState = 'registered' | 'missing_requirement' | 'ineligible' | 'unknown';

/** A synthetic farmer token (K-001 style). No real personal data, ever. */
export interface FarmerToken {
  token: string;
  wardCode: string;
  wardName: string;
  state: FarmerState;
  /** When present, overrides nearest-depot selection. */
  assignedDepotId?: string;
  attributes: {
    /** 'unknown' means the register itself cannot answer -> cannot_determine. */
    inFarmerRegister: boolean | 'unknown';
    nationalIdLinked: boolean;
    /** null acreage makes the acreage criterion 'unknown'. */
    acreage: number | null;
    crop: string;
    priorRedemptions: number;
  };
}

export type CriterionTest =
  | 'in_register'
  | 'id_linked'
  | 'acreage_max'
  | 'ward_participating'
  | 'stock_available';

/** One published programme rule, with its own evidence tag so each trace row can cite. */
export interface RuleCriterion {
  id: string;
  label: string;
  test: CriterionTest;
  /** Numeric parameter, e.g. the acreage cap in acres for 'acreage_max'. */
  param?: number;
  evidence: EvidenceTag;
}

/** Ward centroid used for nearest-depot selection when a farmer has no assigned depot. */
export interface WardCentroid {
  wardCode?: string;
  lat: number;
  lon: number;
}

export interface ProgrammeRules {
  id: string;
  name: string;
  season: string;
  /** Ward NAMES (as written in the Kenya Farmer Register) participating in the programme. */
  participatingWards: string[];
  criteria: RuleCriterion[];
  allocationFormula: { bagsPerAcre: number; maxBags: number };
  evidence: EvidenceTag;
  /**
   * Optional lookup of ward centroids keyed by ward NAME (same key space as
   * participatingWards). The engine uses it to pick the nearest depot by haversine
   * when farmer.assignedDepotId is absent; that selection is tagged Derivation
   * 'calculated'. Without a centroid and without an assigned depot, stock cannot
   * be resolved and the stock criterion evaluates to 'unknown'.
   */
  wardCentroids?: Record<string, WardCentroid>;
}

export interface PriceRow {
  inputType: string;
  subsidizedPriceKes: number;
  marketPriceKes: number;
  bagWeightKg: number;
  /** ISO timestamps; a row applies when validFrom <= now <= validTo. */
  validFrom: string;
  validTo: string;
  evidence: EvidenceTag;
}

export interface Depot {
  id: string;
  name: string;
  lat: number;
  lon: number;
  merchant: string;
  assetType: 'ncpb_depot' | 'agro_dealer';
  stockStatus: 'in_stock' | 'low' | 'unknown';
  /** ISO timestamp of the last stock check, or null when never checked. */
  checkedAt: string | null;
  classification: 'official' | 'simulated';
  evidence: EvidenceTag;
}

/**
 * Operational conclusion:
 * - confirmed: every needed fact is verified (a confirmed NEGATIVE is still confirmed);
 * - indicated_by_published_rules: rules say yes but an operational fact (stock) is unverified;
 * - cannot_determine: an eligibility fact itself is unknown.
 */
export type Conclusion = 'confirmed' | 'indicated_by_published_rules' | 'cannot_determine';

/** Per-criterion evaluation record, always carrying an evidence tag for citation. */
export interface CriterionTrace {
  criterionId: string;
  label: string;
  result: 'pass' | 'fail' | 'unknown';
  /** The raw value the engine looked at (acreage, register flag, stock status, ...). */
  observed: unknown;
  evidence: EvidenceTag;
}

export interface Decision {
  farmerToken: string;
  wardName: string;
  conclusion: Conclusion;
  /** null when the conclusion is cannot_determine. */
  eligible: boolean | null;
  /** Label of the first failing criterion, when eligible === false. */
  missingRequirement: string | null;
  /** Whole bags; null unless eligible === true and acreage is known. */
  allocationBags: number | null;
  pricePerBagKes: number | null;
  marketPriceKes: number | null;
  /** (market - subsidized) * allocationBags, when all three are known. Tagged 'calculated'. */
  savingsKes: number | null;
  depot: {
    id: string;
    name: string;
    stock: Freshness;
    classification: 'official' | 'simulated';
  } | null;
  trace: CriterionTrace[];
  /** De-duplicated union of every evidence tag the decision relied on. */
  citations: EvidenceTag[];
  /** Echo of the `now` input — the engine never reads the clock itself. */
  evaluatedAt: string;
  /** One concrete instruction for the farmer. */
  nextAction: string;
  /** The honest-uncertainty sentence, non-null only for indicated_by_published_rules. */
  sijui: string | null;
  /** Set by the API layer, not the engine. */
  dataMode?: 'supabase' | 'bundled';
}
