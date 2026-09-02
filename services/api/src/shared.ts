/**
 * Single import surface for @terramavuno/shared inside services/api.
 *
 * The shared package's root barrel (packages/shared/src/index.ts) re-exports the
 * eligibility engine, the Kilimo tool registry and the bundled dataset, so we
 * import from the package root rather than reaching into compiled subpaths.
 * Keeping every shared import in ONE file means a barrel change touches only
 * this file. Requires `npm run build --workspace @terramavuno/shared` first
 * (package main is dist/index.js).
 */
export {
  SIJUI_TEXT,
  evaluateFarmer,
  freshnessOf,
  haversineKm,
  nearestDepot,
} from '@terramavuno/shared';
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
} from '@terramavuno/shared';

export {
  KILIMO_TOOLS,
  UI_TOOL_NAMES,
  DATA_TOOL_NAMES,
  isUiTool,
  isDataTool,
  toAnthropicTools,
  toElevenLabsClientTools,
} from '@terramavuno/shared';
export type { AnthropicToolDefinition } from '@terramavuno/shared';

export {
  KILIMO_FALLBACK,
  KILIMO_PROGRAMME,
  KILIMO_PRICES,
  KILIMO_DEPOTS,
  KILIMO_FARMERS,
  KILIMO_WARDS,
  KILIMO_SOURCES,
} from '@terramavuno/shared';
export type {
  FallbackDepot,
  FallbackFarmer,
  FallbackProgramme,
  KilimoFallback,
  SourceRecord,
  WardRecord,
} from '@terramavuno/shared';
