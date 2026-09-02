/** Barrel for the deterministic eligibility engine, its types and canonical fixtures. */
export type {
  Authority,
  Conclusion,
  CriterionTest,
  CriterionTrace,
  Decision,
  Depot,
  Derivation,
  EvidenceTag,
  FarmerState,
  FarmerToken,
  Freshness,
  PriceRow,
  ProgrammeRules,
  RuleCriterion,
  WardCentroid,
} from './types.js';
export {
  FRESHNESS_MAX_AGE_HOURS,
  SIJUI_TEXT,
  evaluateFarmer,
  freshnessOf,
  haversineKm,
  nearestDepot,
  type EvaluateFarmerInput,
} from './engine.js';
export {
  DEMO_NOW,
  DEPOTS,
  FARMERS,
  KANDARA_WARD_CENTROIDS,
  PRICES,
  PROGRAMME,
} from './fixtures.js';
