import {describe, expect, it} from 'vitest';
import {SIJUI_TEXT, evaluateFarmer, freshnessOf, haversineKm, nearestDepot} from './engine.js';
import {DEMO_NOW, DEPOTS, FARMERS, KANDARA_WARD_CENTROIDS, PRICES, PROGRAMME} from './fixtures.js';
import type {FarmerToken, ProgrammeRules} from './types.js';

const farmer = (token: string): FarmerToken => {
  const found = FARMERS.find((f) => f.token === token);
  if (!found) throw new Error(`missing fixture farmer ${token}`);
  return found;
};
const evaluate = (f: FarmerToken, programme: ProgrammeRules = PROGRAMME) =>
  evaluateFarmer({farmer: f, programme, prices: PRICES, depots: DEPOTS, now: DEMO_NOW});

describe('eligibility engine — canonical farmer states', () => {
  it('K-001 registered: confirmed, eligible, 4 bags at 2,500 vs 6,500 with current NCPB stock', () => {
    const d = evaluate(farmer('K-001'));
    expect(d.conclusion).toBe('confirmed');
    expect(d.eligible).toBe(true);
    expect(d.missingRequirement).toBeNull();
    expect(d.allocationBags).toBe(4);
    expect(d.pricePerBagKes).toBe(2500);
    expect(d.marketPriceKes).toBe(6500);
    expect(d.savingsKes).toBe(16000);
    expect(d.depot).toMatchObject({id: 'ncpb-sagana', classification: 'official'});
    expect(d.depot?.stock.status).toBe('current');
    expect(d.sijui).toBeNull();
    expect(d.nextAction).toContain('NCPB Sagana Depot');
  });

  it('K-002 missing requirement: confirmed NEGATIVE with id_linked as the missing requirement', () => {
    const d = evaluate(farmer('K-002'));
    expect(d.conclusion).toBe('confirmed');
    expect(d.eligible).toBe(false);
    expect(d.missingRequirement).toBe('National ID linked to register entry');
    expect(d.nextAction).toContain('ward agricultural office');
    expect(d.allocationBags).toBeNull();
  });

  it('K-003 ineligible: confirmed negative on the 5-acre cap', () => {
    const d = evaluate(farmer('K-003'));
    expect(d.conclusion).toBe('confirmed');
    expect(d.eligible).toBe(false);
    expect(d.missingRequirement).toBe('Farm size within the 5-acre cap');
    expect(d.allocationBags).toBeNull();
    expect(d.nextAction).toContain('county agriculture office');
  });

  it('K-004 sijui: indicated_by_published_rules with the exact sijui sentence and an unknown stock trace', () => {
    const d = evaluate(farmer('K-004'));
    expect(d.conclusion).toBe('indicated_by_published_rules');
    expect(d.eligible).toBe(true);
    expect(d.sijui).toBe("Rules indicate you qualify, but I cannot verify today's stock at this depot.");
    expect(d.sijui).toBe(SIJUI_TEXT);
    const stockRow = d.trace.find((t) => t.criterionId === 'stock_available');
    expect(stockRow?.result).toBe('unknown');
    expect(d.depot).toMatchObject({id: 'kabati-agrovet', classification: 'simulated'});
    expect(d.depot?.stock).toEqual({checkedAt: null, status: 'unknown'});
    expect(d.nextAction).toContain('Confirm');
  });

  it('cannot_determine when inFarmerRegister is the string "unknown"', () => {
    const d = evaluate({
      ...farmer('K-001'),
      token: 'K-099',
      state: 'unknown',
      attributes: {...farmer('K-001').attributes, inFarmerRegister: 'unknown'},
    });
    expect(d.conclusion).toBe('cannot_determine');
    expect(d.eligible).toBeNull();
    expect(d.missingRequirement).toBeNull();
    expect(d.allocationBags).toBeNull();
    expect(d.trace.find((t) => t.criterionId === 'in_register')?.result).toBe('unknown');
    expect(d.nextAction).toContain('ward agricultural office');
  });
});

describe('allocation formula', () => {
  it('7.5 acres fails the cap outright (no allocation), and an eligible 6-acre farmer caps at maxBags 10', () => {
    const overCap = evaluate(farmer('K-003'));
    expect(overCap.eligible).toBe(false); // 2 * 7.5 = 15 would exceed maxBags, but the cap fails first
    expect(overCap.allocationBags).toBeNull();

    const relaxed: ProgrammeRules = {
      ...PROGRAMME,
      criteria: PROGRAMME.criteria.map((c) => (c.test === 'acreage_max' ? {...c, param: 8} : c)),
    };
    const capped = evaluate(
      {...farmer('K-001'), token: 'K-100', attributes: {...farmer('K-001').attributes, acreage: 6}},
      relaxed,
    );
    expect(capped.eligible).toBe(true);
    expect(capped.allocationBags).toBe(10); // min(2 * 6, 10)
    expect(capped.savingsKes).toBe(40000);
  });
});

describe('determinism and citations', () => {
  it('identical inputs produce deep-equal decisions', () => {
    for (const f of FARMERS) {
      const a = evaluate(f);
      const b = evaluate(f);
      expect(a).toStrictEqual(b);
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    }
  });

  it('every trace row carries a complete evidence tag and citations are de-duplicated', () => {
    for (const f of FARMERS) {
      const d = evaluate(f);
      for (const row of d.trace) {
        expect(row.evidence.sourceId.length).toBeGreaterThan(0);
        expect(row.evidence.citation.length).toBeGreaterThan(0);
        expect(['official', 'reported']).toContain(row.evidence.authority);
        expect(['direct', 'calculated', 'inferred', 'simulated']).toContain(row.evidence.derivation);
        expect(['current', 'stale', 'unknown']).toContain(row.evidence.freshness.status);
      }
      expect(d.citations.length).toBeGreaterThan(0);
      const keys = d.citations.map((c) => JSON.stringify(c));
      expect(new Set(keys).size).toBe(keys.length);
    }
  });
});

describe('pure helpers', () => {
  it('haversineKm is ~0 for identical points and symmetric', () => {
    expect(haversineKm(-0.85, 36.95, -0.85, 36.95)).toBe(0);
    const ab = haversineKm(-0.85, 36.96, -0.66, 37.2);
    expect(ab).toBeCloseTo(haversineKm(-0.66, 37.2, -0.85, 36.96), 10);
    expect(ab).toBeGreaterThan(20); // Muruka centroid to Sagana is tens of km
  });

  it('nearestDepot from the Muruka centroid picks Kabati Agrovet (a calculated selection)', () => {
    const c = KANDARA_WARD_CENTROIDS['Muruka'];
    expect(nearestDepot(DEPOTS, c.lat, c.lon)?.id).toBe('kabati-agrovet');
    expect(nearestDepot([], c.lat, c.lon)).toBeNull();
    const k002 = evaluate(farmer('K-002')); // no assignedDepotId -> nearest by haversine
    expect(k002.depot?.id).toBe('kabati-agrovet');
    expect(k002.trace.find((t) => t.criterionId === 'stock_available')?.evidence.derivation).toBe('calculated');
  });

  it('freshnessOf: current within 24h, stale beyond, unknown when never checked', () => {
    const base = DEPOTS.find((d) => d.id === 'ncpb-sagana');
    if (!base) throw new Error('missing ncpb-sagana fixture');
    expect(freshnessOf(base, DEMO_NOW).status).toBe('current');
    expect(freshnessOf({...base, checkedAt: '2026-08-25T06:00:00Z'}, DEMO_NOW).status).toBe('stale');
    expect(freshnessOf({...base, checkedAt: null}, DEMO_NOW)).toEqual({checkedAt: null, status: 'unknown'});
  });
});
