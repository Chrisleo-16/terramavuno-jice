/**
 * The WhatsApp text is the only artefact that leaves the demo and lands on a
 * real phone, so its honesty markers are pinned here: the engine's conclusion
 * word, the verbatim sijui sentence, the unknown-stock statement, the citation
 * footer, and the SIMULATED notice.
 */
import { describe, expect, it } from 'vitest';
import {
  activeShareProvider,
  formatDecisionForWhatsApp,
  isSimulated,
  normalisePhone,
  waMeLink,
} from './share.js';
import { SIJUI_TEXT, type Decision, type EvidenceTag } from '../shared.js';

const officialTag: EvidenceTag = {
  authority: 'official',
  derivation: 'direct',
  freshness: { checkedAt: '2026-08-14T00:00:00Z', status: 'current' },
  sourceId: 'moald-subsidy-circular-2026',
  citation: 'MoALD subsidy circular — 2026 Long Rains, effective 2026-08-14',
};

const simulatedTag: EvidenceTag = {
  authority: 'reported',
  derivation: 'simulated',
  freshness: { checkedAt: null, status: 'unknown' },
  sourceId: 'simulated-depots',
  citation: 'SIMULATED depot fixture — Kabati Agrovet',
};

const confirmed: Decision = {
  farmerToken: 'K-001',
  wardName: "Ng'araria",
  conclusion: 'confirmed',
  eligible: true,
  missingRequirement: null,
  allocationBags: 4,
  pricePerBagKes: 2500,
  marketPriceKes: 6500,
  savingsKes: 16000,
  depot: {
    id: 'ncpb-sagana',
    name: 'NCPB Sagana Depot',
    stock: { checkedAt: '2026-09-02T06:00:00Z', status: 'current' },
    classification: 'official',
  },
  trace: [],
  citations: [officialTag],
  evaluatedAt: '2026-09-02T07:00:00Z',
  nextAction: 'Carry your national ID to NCPB Sagana Depot to redeem your allocation.',
  sijui: null,
  dataMode: 'bundled',
};

const sijuiCase: Decision = {
  ...confirmed,
  farmerToken: 'K-004',
  wardName: 'Ithiru',
  conclusion: 'indicated_by_published_rules',
  allocationBags: 6,
  savingsKes: 24000,
  depot: {
    id: 'kabati-agrovet',
    name: 'Kabati Agrovet',
    stock: { checkedAt: null, status: 'unknown' },
    classification: 'simulated',
  },
  citations: [officialTag, simulatedTag],
  sijui: SIJUI_TEXT,
  nextAction: "Confirm today's stock at Kabati Agrovet before travelling.",
};

const negative: Decision = {
  ...confirmed,
  farmerToken: 'K-002',
  wardName: 'Muruka',
  eligible: false,
  missingRequirement: 'National ID linked to register entry',
  allocationBags: null,
  savingsKes: null,
  sijui: null,
};

describe('formatDecisionForWhatsApp', () => {
  it('bolds the conclusion and reports allocation, price and depot', () => {
    const text = formatDecisionForWhatsApp(confirmed);
    expect(text).toContain('*CONFIRMED*');
    expect(text).toContain('*Allocation:* 4 bags (50 kg each)');
    expect(text).toContain('KES 2,500 per bag');
    expect(text).toContain('market KES 6,500');
    expect(text).toContain('*Depot:* NCPB Sagana Depot');
    expect(text).toContain('Stock checked: 2026-09-02T06:00:00Z (current)');
    expect(text).toContain('*Next action:*');
  });

  it('includes a citation footer with authority / derivation / freshness', () => {
    const text = formatDecisionForWhatsApp(confirmed);
    expect(text).toContain('*Sources*');
    expect(text).toContain('[official / direct / current, checked 2026-08-14T00:00:00Z]');
  });

  it('reproduces the sijui sentence verbatim and says stock is unknown', () => {
    const text = formatDecisionForWhatsApp(sijuiCase);
    expect(text).toContain('*INDICATED BY PUBLISHED RULES*');
    expect(text).toContain(SIJUI_TEXT);
    expect(text).toContain('Stock: UNKNOWN');
    expect(text).not.toContain('Stock checked:');
  });

  it('adds the SIMULATED notice only when a simulated record is involved', () => {
    expect(formatDecisionForWhatsApp(sijuiCase)).toContain('*SIMULATED*');
    expect(formatDecisionForWhatsApp(confirmed)).not.toContain('*SIMULATED*');
    expect(isSimulated(sijuiCase)).toBe(true);
    expect(isSimulated(confirmed)).toBe(false);
  });

  it('names the missing requirement on a confirmed negative', () => {
    const text = formatDecisionForWhatsApp(negative);
    expect(text).toContain('*CONFIRMED*');
    expect(text).toContain('Not eligible');
    expect(text).toContain('*Missing requirement:* National ID linked to register entry');
    expect(text).not.toContain('*Allocation:*');
  });

  it('says so plainly when eligibility cannot be determined', () => {
    const text = formatDecisionForWhatsApp({
      ...confirmed,
      conclusion: 'cannot_determine',
      eligible: null,
      allocationBags: null,
      savingsKes: null,
    });
    expect(text).toContain('*CANNOT DETERMINE*');
    expect(text).toContain('Eligibility could not be determined.');
  });

  it('never leaks "undefined" or "null" into a farmer-facing message', () => {
    for (const decision of [confirmed, sijuiCase, negative]) {
      const text = formatDecisionForWhatsApp(decision);
      expect(text).not.toContain('undefined');
      expect(text).not.toMatch(/\bnull\b/);
    }
  });
});

describe('share plumbing', () => {
  it('builds a credential-free wa.me deep link', () => {
    expect(waMeLink(confirmed, '+254 700 000 000')).toContain('https://wa.me/254700000000?text=');
    expect(waMeLink(confirmed)).toContain('https://wa.me/?text=');
  });

  it('strips punctuation from phone numbers', () => {
    expect(normalisePhone('+254-700 123456')).toBe('254700123456');
  });

  it('reports no provider when nothing is configured', () => {
    delete process.env.EVOLUTION_API_URL;
    delete process.env.EVOLUTION_API_KEY;
    delete process.env.EVOLUTION_INSTANCE_NAME;
    delete process.env.WHATSAPP_CLOUD_ACCESS_TOKEN;
    delete process.env.WHATSAPP_CLOUD_PHONE_NUMBER_ID;
    expect(activeShareProvider()).toBe('none');
  });

  it('prefers Evolution API when its three vars are set', () => {
    process.env.EVOLUTION_API_URL = 'https://evo.example.com';
    process.env.EVOLUTION_API_KEY = 'k';
    process.env.EVOLUTION_INSTANCE_NAME = 'terramavuno';
    process.env.WHATSAPP_CLOUD_ACCESS_TOKEN = 't';
    process.env.WHATSAPP_CLOUD_PHONE_NUMBER_ID = '1';
    expect(activeShareProvider()).toBe('evolution');
    delete process.env.EVOLUTION_API_URL;
    expect(activeShareProvider()).toBe('whatsapp_cloud');
  });
});
