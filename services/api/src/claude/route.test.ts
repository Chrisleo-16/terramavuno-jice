/**
 * The loop invariant, tested on the pure helper (no network, no SSE socket):
 * EVERY tool_use block gets exactly one tool_result. If a browser-executed
 * tool did not produce one, the Messages API would reject the next request and
 * the turn would deadlock — which is the one failure the demo cannot survive.
 */
import type Anthropic from '@anthropic-ai/sdk';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  MAX_LOOP_ITERATIONS,
  UI_TOOL_ACK,
  buildRequestParams,
  readToolUse,
  resolveToolUse,
  type ChatSseEvent,
} from './route.js';
import { SYSTEM_PROMPT } from './systemPrompt.js';

beforeAll(() => {
  delete process.env.SUPABASE_URL;
  delete process.env.VITE_SUPABASE_URL;
  delete process.env.SUPABASE_SECRET_KEY;
});

const toolUseBlock = (name: string, input: unknown, id = 'toolu_1'): Anthropic.ContentBlock =>
  ({ type: 'tool_use', id, name, input }) as Anthropic.ContentBlock;

function collector(): { events: ChatSseEvent[]; emit: (e: ChatSseEvent) => void } {
  const events: ChatSseEvent[] = [];
  return { events, emit: (e) => events.push(e) };
}

describe('resolveToolUse', () => {
  it('answers a UI tool with an ack so the loop cannot deadlock', async () => {
    const { events, emit } = collector();
    const use = readToolUse(
      toolUseBlock('fly_to_location', { query: "Ng'araria ward, Murang'a" }, 'toolu_ui'),
    );
    expect(use).not.toBeNull();

    const result = await resolveToolUse(use!, emit);

    expect(result.type).toBe('tool_result');
    expect(result.tool_use_id).toBe('toolu_ui');
    expect(JSON.parse(String(result.content))).toEqual(UI_TOOL_ACK);
    expect(result.is_error).toBeUndefined();

    // ...and the browser was told to run it.
    const action = events.find((e) => e.type === 'client_action');
    expect(action).toEqual({
      type: 'client_action',
      id: 'toolu_ui',
      name: 'fly_to_location',
      args: { query: "Ng'araria ward, Murang'a" },
    });
  });

  it('answers show_result_card too — every UI tool, not just the camera', async () => {
    const { emit } = collector();
    const use = readToolUse(toolUseBlock('show_result_card', { decision: { conclusion: 'confirmed' } }));
    const result = await resolveToolUse(use!, emit);
    expect(JSON.parse(String(result.content))).toEqual({ ok: true, note: 'dispatched to map' });
  });

  it('executes a data tool server-side and returns the real result', async () => {
    const { events, emit } = collector();
    const use = readToolUse(toolUseBlock('evaluate_farmer', { token: 'K-004' }, 'toolu_data'));
    const result = await resolveToolUse(use!, emit);

    const payload = JSON.parse(String(result.content)) as {
      ok: boolean;
      data: { decision: { conclusion: string; sijui: string | null } };
    };
    expect(payload.ok).toBe(true);
    expect(payload.data.decision.conclusion).toBe('indicated_by_published_rules');
    expect(payload.data.decision.sijui).toBe(
      "Rules indicate you qualify, but I cannot verify today's stock at this depot.",
    );
    expect(events.some((e) => e.type === 'tool_result' && e.ok)).toBe(true);
  });

  it('still answers an unknown tool name, flagged is_error', async () => {
    const { emit } = collector();
    const use = readToolUse(toolUseBlock('launch_missiles', {}, 'toolu_bad'));
    const result = await resolveToolUse(use!, emit);
    expect(result.tool_use_id).toBe('toolu_bad');
    expect(result.is_error).toBe(true);
  });

  it('answers every block in a parallel tool-use turn', async () => {
    const { emit } = collector();
    const blocks = [
      toolUseBlock('fly_to_location', { query: 'Kandara' }, 'a'),
      toolUseBlock('set_layer_visibility', { layerId: 'depots', visible: true }, 'b'),
      toolUseBlock('get_programme', {}, 'c'),
    ];
    const uses = blocks.map(readToolUse).filter((u) => u !== null);
    const results = await Promise.all(uses.map((u) => resolveToolUse(u!, emit)));

    expect(results.map((r) => r.tool_use_id)).toEqual(['a', 'b', 'c']);
    expect(results).toHaveLength(blocks.length);
  });

  it('reads structured input and never string-matches JSON', () => {
    // A null/absent input must degrade to {}, not to a parse attempt.
    expect(readToolUse(toolUseBlock('get_programme', null))?.input).toEqual({});
    expect(readToolUse(toolUseBlock('get_farmer', { token: 'K-001' }))?.input).toEqual({
      token: 'K-001',
    });
    expect(readToolUse({ type: 'text', text: 'hello', citations: null } as Anthropic.ContentBlock)).toBeNull();
  });
});

describe('buildRequestParams', () => {
  it('puts tools first and marks the last system block as ephemeral cache', () => {
    const params = buildRequestParams([{ role: 'user', content: 'hi' }], 'claude-sonnet-5');
    const keys = Object.keys(params);
    expect(keys.indexOf('tools')).toBeLessThan(keys.indexOf('messages'));

    const system = params['system'] as { text: string; cache_control?: unknown }[];
    expect(system).toHaveLength(1);
    expect(system[0]?.text).toBe(SYSTEM_PROMPT);
    expect(system[0]?.cache_control).toEqual({ type: 'ephemeral' });

    // All 8 shared tools are exposed, both UI and data.
    expect((params['tools'] as unknown[]).length).toBe(8);
    expect(params['model']).toBe('claude-sonnet-5');
    expect(params['max_tokens']).toBeGreaterThan(1000);
  });

  it('is byte-stable across calls so the cached prefix survives', () => {
    const a = buildRequestParams([{ role: 'user', content: 'x' }], 'claude-sonnet-5');
    const b = buildRequestParams([{ role: 'user', content: 'x' }], 'claude-sonnet-5');
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('caps the agentic loop', () => {
    expect(MAX_LOOP_ITERATIONS).toBeGreaterThan(3);
    expect(MAX_LOOP_ITERATIONS).toBeLessThan(50);
  });
});

describe('system prompt honesty invariants', () => {
  it('states the engine decides and Claude explains', () => {
    expect(SYSTEM_PROMPT).toContain('THE ENGINE DECIDES, YOU EXPLAIN');
    expect(SYSTEM_PROMPT).toContain('evaluate_farmer');
    expect(SYSTEM_PROMPT).toContain('cannot_determine');
    expect(SYSTEM_PROMPT).toContain('sijui');
    expect(SYSTEM_PROMPT).toContain('show_result_card');
    expect(SYSTEM_PROMPT).toContain('Kiswahili');
  });

  it('contains no timestamp or id that would invalidate the cache prefix', () => {
    expect(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/.test(SYSTEM_PROMPT)).toBe(false);
  });
});
