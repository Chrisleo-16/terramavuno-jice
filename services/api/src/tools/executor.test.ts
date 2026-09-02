/**
 * The executor is the contract between Claude, the voice agent and the
 * deterministic engine. These tests pin the demo-critical outcomes — above
 * all the sijui case, whose sentence must be reproduced word for word.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { executeDataTool } from './executor.js';
import { SIJUI_TEXT, type Decision } from '../shared.js';

/** Run every test against the bundled snapshot (no network, no keys). */
beforeAll(() => {
  delete process.env.SUPABASE_URL;
  delete process.env.VITE_SUPABASE_URL;
  delete process.env.SUPABASE_SECRET_KEY;
});

async function decisionFor(token: string): Promise<Decision> {
  const result = await executeDataTool('evaluate_farmer', { token });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error('unreachable');
  return (result.data as { decision: Decision }).decision;
}

describe('executeDataTool', () => {
  it('K-004 is the sijui case: indicated_by_published_rules with the exact sentence', async () => {
    const decision = await decisionFor('K-004');
    expect(decision.conclusion).toBe('indicated_by_published_rules');
    expect(decision.eligible).toBe(true);
    expect(decision.sijui).toBe(
      "Rules indicate you qualify, but I cannot verify today's stock at this depot.",
    );
    // ...and it is the shared constant, not a local copy that could drift.
    expect(decision.sijui).toBe(SIJUI_TEXT);
    expect(decision.depot?.stock.status).toBe('unknown');
  });

  it('K-002 is a confirmed negative naming the missing requirement', async () => {
    const decision = await decisionFor('K-002');
    expect(decision.conclusion).toBe('confirmed');
    expect(decision.eligible).toBe(false);
    expect(decision.missingRequirement).toBeTruthy();
    expect(decision.nextAction.toLowerCase()).toContain('ward agricultural office');
    expect(decision.sijui).toBeNull();
  });

  it('K-003 is confirmed ineligible on the acreage cap', async () => {
    const decision = await decisionFor('K-003');
    expect(decision.conclusion).toBe('confirmed');
    expect(decision.eligible).toBe(false);
    expect(decision.allocationBags).toBeNull();
  });

  it('stamps dataMode on the Decision and every payload', async () => {
    const decision = await decisionFor('K-001');
    expect(decision.dataMode).toBe('bundled');

    const programme = await executeDataTool('get_programme', {});
    expect(programme.ok && programme.dataMode).toBe('bundled');
  });

  it('quotes prices from the schedule, never from memory', async () => {
    const result = await executeDataTool('get_price_schedule', { ward: "Ng'araria" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { prices } = result.data as { prices: { subsidizedPriceKes: number; marketPriceKes: number }[] };
    expect(prices[0]?.subsidizedPriceKes).toBe(2500);
    expect(prices[0]?.marketPriceKes).toBe(6500);
  });

  it('returns a structured error (never throws) for an unknown token', async () => {
    const result = await executeDataTool('evaluate_farmer', { token: 'K-999' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('not_found');
    expect(result.error).toContain('Do not guess');
  });

  it('rejects a UI tool name — those never execute server-side', async () => {
    const result = await executeDataTool('fly_to_location', { query: 'Kandara' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('unknown_tool');
  });

  it('rejects missing arguments with invalid_args', async () => {
    const result = await executeDataTool('get_farmer', {});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('invalid_args');
  });
});
