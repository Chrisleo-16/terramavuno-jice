import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEPOTS, FARMERS, PRICES, PROGRAMME } from '../eligibility/fixtures.js';
import {
  KANDARA_WARD_CODES,
  KILIMO_DEPOTS,
  KILIMO_FALLBACK,
  KILIMO_FARMERS,
  KILIMO_WARDS,
  getDepotById,
  getFarmerByToken,
  getWardByCode,
} from './index.js';

describe('bundled kilimo dataset', () => {
  it('index.ts is generated from kilimo-fallback.json (no drift)', () => {
    const raw = readFileSync(new URL('./kilimo-fallback.json', import.meta.url), 'utf8');
    expect(JSON.parse(raw)).toEqual(KILIMO_FALLBACK);
  });

  it('carries the canonical programme, prices and allocation', () => {
    expect(KILIMO_FALLBACK.dataMode).toBe('bundled');
    expect(KILIMO_FALLBACK.programme.id).toBe('ken-fert-subsidy-2026');
    expect(KILIMO_FALLBACK.programme.season).toBe('2026 Long Rains');
    expect(KILIMO_FALLBACK.programme.allocationFormula).toEqual({ bagsPerAcre: 2, maxBags: 10 });
    expect(KILIMO_FALLBACK.prices[0]).toMatchObject({
      subsidizedPriceKes: 2500,
      marketPriceKes: 6500,
      bagWeightKg: 50,
    });
    const tests = KILIMO_FALLBACK.programme.criteria.map((c) => c.test);
    expect(tests).toEqual([
      'in_register',
      'id_linked',
      'acreage_max',
      'ward_participating',
      'stock_available',
    ]);
    expect(KILIMO_FALLBACK.programme.criteria.find((c) => c.test === 'acreage_max')?.param).toBe(5);
  });

  it('is engine-compatible: matches the eligibility fixtures record-for-record', () => {
    // Fallback records are supersets of the fixture records (extra display
    // fields allowed, engine-facing fields identical).
    expect(KILIMO_FALLBACK.programme.criteria).toEqual(PROGRAMME.criteria);
    expect(KILIMO_FALLBACK.programme.allocationFormula).toEqual(PROGRAMME.allocationFormula);
    expect(KILIMO_FALLBACK.programme.participatingWards).toEqual(PROGRAMME.participatingWards);
    expect(KILIMO_FALLBACK.prices).toEqual(PRICES);
    for (const fixture of DEPOTS) {
      expect(getDepotById(fixture.id)).toMatchObject(fixture);
    }
    for (const fixture of FARMERS) {
      expect(getFarmerByToken(fixture.token)).toMatchObject(fixture);
    }
  });

  it('has the six Kandara wards with distinct calculated centroids', () => {
    expect(KILIMO_WARDS).toHaveLength(6);
    expect(KANDARA_WARD_CODES).toEqual(['0539', '0540', '0541', '0542', '0543', '0544']);
    for (const w of KILIMO_WARDS) {
      expect(w.county).toBe("Murang'a");
      expect(w.countyCode).toBe('021');
      expect(w.constituency).toBe('Kandara');
      // programme.wardCentroids (keyed by name) agrees with the ward records
      const centroid = KILIMO_FALLBACK.programme.wardCentroids?.[w.name];
      expect(centroid).toMatchObject({ wardCode: w.code, lat: w.lat, lon: w.lon });
    }
    for (let i = 0; i < KILIMO_WARDS.length; i += 1) {
      for (let j = i + 1; j < KILIMO_WARDS.length; j += 1) {
        const a = KILIMO_WARDS[i];
        const b = KILIMO_WARDS[j];
        expect(Math.hypot(a.lat - b.lat, a.lon - b.lon)).toBeGreaterThan(0.02);
      }
    }
  });

  it('has one official depot and three simulated ones, sijui depot unknown', () => {
    expect(KILIMO_DEPOTS).toHaveLength(4);
    const official = KILIMO_DEPOTS.filter((d) => d.classification === 'official');
    expect(official.map((d) => d.id)).toEqual(['ncpb-sagana']);
    expect(official[0].evidence).toMatchObject({ authority: 'official', derivation: 'direct' });
    for (const d of KILIMO_DEPOTS.filter((x) => x.classification === 'simulated')) {
      expect(d.evidence.authority).toBe('reported');
      expect(d.evidence.derivation).toBe('simulated');
    }
    const sijui = getDepotById('kabati-agrovet');
    expect(sijui?.stockStatus).toBe('unknown');
    expect(sijui?.checkedAt).toBeNull();
    expect(sijui?.evidence.freshness).toEqual({ checkedAt: null, status: 'unknown' });
  });

  it('seeds the five canonical farmer tokens with engine-ready attributes', () => {
    expect(KILIMO_FARMERS.map((f) => f.token)).toEqual([
      'K-001',
      'K-002',
      'K-003',
      'K-004',
      'K-005',
    ]);
    const k1 = getFarmerByToken('k-001');
    expect(k1).toMatchObject({
      state: 'registered',
      wardName: "Ng'araria",
      assignedDepotId: 'ncpb-sagana',
      attributes: { inFarmerRegister: true, nationalIdLinked: true, acreage: 2, crop: 'maize' },
    });
    expect(getFarmerByToken('K-002')?.attributes.nationalIdLinked).toBe(false);
    expect(getFarmerByToken('K-003')?.attributes.acreage).toBeGreaterThan(5);
    const k4 = getFarmerByToken('K-004');
    expect(k4?.state).toBe('registered');
    expect(k4?.assignedDepotId).toBe('kabati-agrovet');
    const k5 = getFarmerByToken('K-005');
    expect(k5?.state).toBe('unknown');
    expect(k5?.attributes.inFarmerRegister).toBe('unknown');
    for (const f of KILIMO_FARMERS) {
      expect(f.classification).toBe('simulated');
      expect(f.token).toMatch(/^K-\d{3}$/);
    }
  });

  it('every evidence tag resolves to a declared source', () => {
    const sourceIds = new Set(KILIMO_FALLBACK.sources.map((s) => s.id));
    const tags = [
      KILIMO_FALLBACK.programme.evidence,
      ...KILIMO_FALLBACK.programme.criteria.map((c) => c.evidence),
      ...KILIMO_FALLBACK.prices.map((p) => p.evidence),
      ...KILIMO_FALLBACK.depots.map((d) => d.evidence),
      ...KILIMO_FALLBACK.farmers.map((f) => f.evidence),
      ...KILIMO_FALLBACK.wards.map((w) => w.evidence),
    ];
    for (const tag of tags) {
      expect(sourceIds.has(tag.sourceId), `unknown sourceId ${tag.sourceId}`).toBe(true);
      expect(tag.citation.length).toBeGreaterThan(10);
      expect(['current', 'stale', 'unknown']).toContain(tag.freshness.status);
    }
  });

  it('ward lookup tolerates apostrophes and hyphens', () => {
    expect(getWardByCode("Ng'araria")?.code).toBe('0539');
    expect(getWardByCode('ngararia')?.code).toBe('0539');
    expect(getWardByCode('Kagundu-ini')?.code).toBe('0541');
    expect(getWardByCode('0544')?.name).toBe('Ruchu');
  });
});
