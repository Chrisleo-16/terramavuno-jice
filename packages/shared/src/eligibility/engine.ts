/**
 * Deterministic subsidy eligibility engine.
 *
 * PURE by contract: no I/O, no Date.now(), no randomness. `now` is a parameter and
 * identical inputs always produce deep-equal Decisions. The engine decides; Claude
 * only explains the Decision and cites its evidence tags.
 */
import type {
  Conclusion,
  CriterionTrace,
  Decision,
  Depot,
  EvidenceTag,
  FarmerToken,
  Freshness,
  PriceRow,
  ProgrammeRules,
  RuleCriterion,
} from './types.js';

/** Stock checks older than this are 'stale'. */
export const FRESHNESS_MAX_AGE_HOURS = 24;

/** The exact honest-uncertainty sentence. Never reworded. */
export const SIJUI_TEXT =
  "Rules indicate you qualify, but I cannot verify today's stock at this depot.";

export interface EvaluateFarmerInput {
  farmer: FarmerToken;
  programme: ProgrammeRules;
  prices: PriceRow[];
  depots: Depot[];
  /** ISO timestamp of "now" — supplied by the caller so the engine stays pure. */
  now: string;
}

/** Great-circle distance in kilometres between two lat/lon points. */
export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (deg: number): number => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(a));
}

/** Nearest depot to a point, or null for an empty list. Ties resolve to the first (stable). */
export function nearestDepot(depots: Depot[], lat: number, lon: number): Depot | null {
  let best: Depot | null = null;
  let bestKm = Infinity;
  for (const depot of depots) {
    const km = haversineKm(lat, lon, depot.lat, depot.lon);
    if (km < bestKm) {
      best = depot;
      bestKm = km;
    }
  }
  return best;
}

/** Freshness of a depot's stock observation relative to `now`. */
export function freshnessOf(depot: Depot, now: string): Freshness {
  if (depot.checkedAt === null) return { checkedAt: null, status: 'unknown' };
  const ageMs = Date.parse(now) - Date.parse(depot.checkedAt);
  if (!Number.isFinite(ageMs)) return { checkedAt: depot.checkedAt, status: 'unknown' };
  const status = ageMs <= FRESHNESS_MAX_AGE_HOURS * 3_600_000 ? 'current' : 'stale';
  return { checkedAt: depot.checkedAt, status };
}

/**
 * Depot resolution: farmer.assignedDepotId wins; otherwise nearest depot by haversine
 * from programme.wardCentroids[farmer.wardName]. A nearest-depot pick is a computation,
 * so its evidence derivation is overridden to 'calculated'.
 */
function resolveDepot(
  farmer: FarmerToken,
  programme: ProgrammeRules,
  depots: Depot[],
): { depot: Depot | null; derivedByDistance: boolean } {
  if (farmer.assignedDepotId !== undefined) {
    return {
      depot: depots.find((d) => d.id === farmer.assignedDepotId) ?? null,
      derivedByDistance: false,
    };
  }
  const centroid = programme.wardCentroids?.[farmer.wardName];
  if (!centroid) return { depot: null, derivedByDistance: false };
  return { depot: nearestDepot(depots, centroid.lat, centroid.lon), derivedByDistance: true };
}

/** First price row whose validity window contains `now`. */
function activePrice(prices: PriceRow[], now: string): PriceRow | null {
  const t = Date.parse(now);
  return (
    prices.find((p) => t >= Date.parse(p.validFrom) && t <= Date.parse(p.validTo)) ?? null
  );
}

function evaluateCriterion(
  criterion: RuleCriterion,
  farmer: FarmerToken,
  programme: ProgrammeRules,
  depot: Depot | null,
  depotDerived: boolean,
  now: string,
): CriterionTrace {
  const { attributes } = farmer;
  let result: CriterionTrace['result'];
  let observed: unknown;
  let evidence: EvidenceTag = criterion.evidence;

  switch (criterion.test) {
    case 'in_register':
      observed = attributes.inFarmerRegister;
      result =
        attributes.inFarmerRegister === 'unknown'
          ? 'unknown'
          : attributes.inFarmerRegister
            ? 'pass'
            : 'fail';
      break;
    case 'id_linked':
      observed = attributes.nationalIdLinked;
      result = attributes.nationalIdLinked ? 'pass' : 'fail';
      break;
    case 'acreage_max':
      observed = attributes.acreage;
      result =
        attributes.acreage === null
          ? 'unknown'
          : attributes.acreage <= (criterion.param ?? Infinity)
            ? 'pass'
            : 'fail';
      break;
    case 'ward_participating':
      observed = farmer.wardName;
      result = programme.participatingWards.includes(farmer.wardName) ? 'pass' : 'fail';
      break;
    case 'stock_available':
      if (depot === null) {
        observed = null;
        result = 'unknown';
        evidence = { ...criterion.evidence, freshness: { checkedAt: null, status: 'unknown' } };
      } else {
        observed = depot.stockStatus;
        result = depot.stockStatus === 'unknown' ? 'unknown' : 'pass'; // in_stock and low both pass
        evidence = {
          ...depot.evidence,
          derivation: depotDerived ? 'calculated' : depot.evidence.derivation,
          freshness: freshnessOf(depot, now),
        };
      }
      break;
  }

  return { criterionId: criterion.id, label: criterion.label, result, observed, evidence };
}

function nextActionFor(
  conclusion: Conclusion,
  eligible: boolean | null,
  failedTest: RuleCriterion['test'] | null,
  farmer: FarmerToken,
  depot: Depot | null,
  acreageCap: number | undefined,
): string {
  if (conclusion === 'cannot_determine') {
    return `Your registration status could not be determined from published records. Visit the ${farmer.wardName} ward agricultural office with your national ID to confirm your Kenya Farmer Register entry.`;
  }
  if (eligible === false) {
    switch (failedTest) {
      case 'in_register':
        return `Register in the Kenya Farmer Register at the ${farmer.wardName} ward agricultural office, then request a new eligibility check.`;
      case 'id_linked':
        return `Visit the ${farmer.wardName} ward agricultural office to link your national ID to your Kenya Farmer Register entry, then request a new eligibility check.`;
      case 'acreage_max':
        return `Your declared acreage exceeds the ${acreageCap ?? ''}-acre programme cap. Contact the Murang'a county agriculture office about standard-rate purchase options.`;
      case 'ward_participating':
        return `${farmer.wardName} ward is not on the programme's participating list. Contact the Murang'a county agriculture office for programmes covering your ward.`;
      default:
        return `Visit the ${farmer.wardName} ward agricultural office to resolve the missing requirement, then request a new eligibility check.`;
    }
  }
  if (conclusion === 'indicated_by_published_rules') {
    return depot
      ? `Confirm today's stock at ${depot.name} before travelling, and carry your national ID.`
      : 'Confirm depot stock with the ward agricultural office before travelling, and carry your national ID.';
  }
  return depot
    ? `Carry your national ID to ${depot.name} to redeem your subsidized fertilizer allocation.`
    : 'Carry your national ID to your assigned depot to redeem your subsidized fertilizer allocation.';
}

/** Deep-equality de-duplication of evidence tags, preserving first-seen order. */
function dedupeCitations(tags: EvidenceTag[]): EvidenceTag[] {
  const seen = new Set<string>();
  const out: EvidenceTag[] = [];
  for (const tag of tags) {
    const key = JSON.stringify([
      tag.sourceId,
      tag.citation,
      tag.authority,
      tag.derivation,
      tag.freshness.status,
      tag.freshness.checkedAt,
    ]);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(tag);
    }
  }
  return out;
}

/**
 * Evaluate one farmer against the published programme rules. Pure and deterministic.
 *
 * Conclusion precedence:
 *  (a) any ELIGIBILITY criterion (everything except stock_available) 'unknown'
 *      -> cannot_determine, eligible null;
 *  (b) any eligibility criterion 'fail' -> confirmed, eligible false,
 *      missingRequirement = first failing criterion's label (a confirmed negative IS confirmed);
 *  (c) all eligibility criteria pass but the stock observation is 'unknown' or not
 *      current -> indicated_by_published_rules, eligible true, sijui = SIJUI_TEXT;
 *  (d) all pass and stock freshness is 'current' -> confirmed, eligible true, sijui null.
 */
export function evaluateFarmer(input: EvaluateFarmerInput): Decision {
  const { farmer, programme, prices, depots, now } = input;
  const { depot, derivedByDistance } = resolveDepot(farmer, programme, depots);

  const trace: CriterionTrace[] = programme.criteria.map((criterion) =>
    evaluateCriterion(criterion, farmer, programme, depot, derivedByDistance, now),
  );

  const testOf = new Map(programme.criteria.map((c) => [c.id, c.test] as const));
  const eligibilityTraces = trace.filter((t) => testOf.get(t.criterionId) !== 'stock_available');
  const stockTrace = trace.find((t) => testOf.get(t.criterionId) === 'stock_available') ?? null;

  const firstUnknown = eligibilityTraces.find((t) => t.result === 'unknown') ?? null;
  const firstFail = eligibilityTraces.find((t) => t.result === 'fail') ?? null;
  const failedCriterion = firstFail
    ? (programme.criteria.find((c) => c.id === firstFail.criterionId) ?? null)
    : null;
  const acreageCap = programme.criteria.find((c) => c.test === 'acreage_max')?.param;

  const stockFreshness: Freshness = depot
    ? freshnessOf(depot, now)
    : { checkedAt: null, status: 'unknown' };

  let conclusion: Conclusion;
  let eligible: boolean | null;
  let sijui: string | null = null;
  if (firstUnknown) {
    conclusion = 'cannot_determine';
    eligible = null;
  } else if (firstFail) {
    conclusion = 'confirmed'; // a confirmed negative is still confirmed
    eligible = false;
  } else {
    eligible = true;
    const stockVerifiedNow = stockTrace !== null
      ? stockTrace.result === 'pass' && stockFreshness.status === 'current'
      : true; // programme without a stock criterion: rules alone decide
    if (stockVerifiedNow) {
      conclusion = 'confirmed';
    } else {
      conclusion = 'indicated_by_published_rules';
      sijui = SIJUI_TEXT;
    }
  }

  // Allocation (tagged 'calculated' via the savings/allocation being engine-computed):
  // whole bags, only meaningful for an eligible farmer with known acreage.
  const { bagsPerAcre, maxBags } = programme.allocationFormula;
  const allocationBags =
    eligible === true && farmer.attributes.acreage !== null
      ? Math.floor(Math.min(bagsPerAcre * farmer.attributes.acreage, maxBags))
      : null;

  const price = activePrice(prices, now);
  const pricePerBagKes = price ? price.subsidizedPriceKes : null;
  const marketPriceKes = price ? price.marketPriceKes : null;
  const savingsKes =
    allocationBags !== null && pricePerBagKes !== null && marketPriceKes !== null
      ? (marketPriceKes - pricePerBagKes) * allocationBags
      : null;

  const citationPool: EvidenceTag[] = [programme.evidence, ...trace.map((t) => t.evidence)];
  if (price) citationPool.push(price.evidence);
  if (depot) citationPool.push(depot.evidence);

  return {
    farmerToken: farmer.token,
    wardName: farmer.wardName,
    conclusion,
    eligible,
    missingRequirement: firstFail ? firstFail.label : null,
    allocationBags,
    pricePerBagKes,
    marketPriceKes,
    savingsKes,
    depot: depot
      ? { id: depot.id, name: depot.name, stock: stockFreshness, classification: depot.classification }
      : null,
    trace,
    citations: dedupeCitations(citationPool),
    evaluatedAt: now,
    nextAction: nextActionFor(
      conclusion,
      eligible,
      failedCriterion ? failedCriterion.test : null,
      farmer,
      depot,
      acreageCap,
    ),
    sijui,
  };
}
