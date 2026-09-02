import { describe, expect, it } from 'vitest';
import {
  DATA_TOOL_NAMES,
  KILIMO_TOOLS,
  UI_TOOL_NAMES,
  isDataTool,
  isUiTool,
  toAnthropicTools,
  toElevenLabsClientTools,
} from './kilimo-tools.js';

describe('KILIMO_TOOLS registry', () => {
  it('defines exactly 8 tools', () => {
    expect(KILIMO_TOOLS).toHaveLength(8);
  });

  it('has unique tool names', () => {
    const names = KILIMO_TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('gives every tool a strict object schema with additionalProperties:false and a required array', () => {
    for (const tool of KILIMO_TOOLS) {
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.inputSchema.additionalProperties).toBe(false);
      expect(Array.isArray(tool.inputSchema.required)).toBe(true);
      // every required key actually exists in properties
      for (const key of tool.inputSchema.required) {
        expect(Object.keys(tool.inputSchema.properties)).toContain(key);
      }
    }
  });

  it('gives every tool a non-empty description and a valid kind', () => {
    for (const tool of KILIMO_TOOLS) {
      expect(tool.description.length).toBeGreaterThan(20);
      expect(['ui', 'data']).toContain(tool.kind);
    }
  });
});

describe('UI/DATA partition', () => {
  it('covers all 8 tools with no overlap', () => {
    const ui = new Set<string>(UI_TOOL_NAMES);
    const data = new Set<string>(DATA_TOOL_NAMES);
    expect(ui.size + data.size).toBe(KILIMO_TOOLS.length);
    for (const name of ui) expect(data.has(name)).toBe(false);
    const union = new Set([...ui, ...data]);
    for (const tool of KILIMO_TOOLS) expect(union.has(tool.name)).toBe(true);
  });

  it('isUiTool / isDataTool agree with the partition and reject unknown names', () => {
    for (const tool of KILIMO_TOOLS) {
      expect(isUiTool(tool.name)).toBe(tool.kind === 'ui');
      expect(isDataTool(tool.name)).toBe(tool.kind === 'data');
    }
    expect(isUiTool('not_a_tool')).toBe(false);
    expect(isDataTool('not_a_tool')).toBe(false);
  });

  it('matches the expected canonical split', () => {
    expect([...UI_TOOL_NAMES].sort()).toEqual(
      ['fly_to_location', 'set_layer_visibility', 'show_result_card'].sort(),
    );
    expect([...DATA_TOOL_NAMES].sort()).toEqual(
      ['get_programme', 'get_price_schedule', 'get_depots', 'get_farmer', 'evaluate_farmer'].sort(),
    );
  });
});

describe('toAnthropicTools()', () => {
  it('emits exactly the keys name, description, input_schema for all 8 tools', () => {
    const tools = toAnthropicTools();
    expect(tools).toHaveLength(8);
    for (const tool of tools) {
      expect(Object.keys(tool).sort()).toEqual(['description', 'input_schema', 'name']);
    }
  });

  it('passes schemas through verbatim from the registry', () => {
    const tools = toAnthropicTools();
    for (const [i, tool] of tools.entries()) {
      expect(tool.name).toBe(KILIMO_TOOLS[i].name);
      expect(tool.input_schema).toEqual(KILIMO_TOOLS[i].inputSchema);
    }
  });
});

describe('toElevenLabsClientTools()', () => {
  it('emits 8 client tools with the ElevenLabs declaration shape', () => {
    const tools = toElevenLabsClientTools();
    expect(tools).toHaveLength(8);
    for (const tool of tools) {
      expect(Object.keys(tool).sort()).toEqual(
        ['description', 'expects_response', 'name', 'parameters', 'type'].sort(),
      );
      expect(tool.type).toBe('client');
      // The live ElevenLabs Agents API rejects `additionalProperties` with
      // HTTP 422 extra_forbidden, while Anthropic requires it. The adapter
      // strips it recursively — verified against the real API.
      expect(tool.parameters).not.toHaveProperty('additionalProperties');
    }
  });

  it('only data tools expect a response', () => {
    for (const tool of toElevenLabsClientTools()) {
      expect(tool.expects_response).toBe(isDataTool(tool.name));
    }
  });

  it('strips additionalProperties everywhere, including nested schemas', () => {
    const seen: string[] = [];
    const walk = (node: unknown, at: string): void => {
      if (Array.isArray(node)) return node.forEach((n, i) => walk(n, `${at}[${i}]`));
      if (node === null || typeof node !== 'object') return;
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        if (k === 'additionalProperties') seen.push(`${at}.${k}`);
        walk(v, `${at}.${k}`);
      }
    };
    for (const tool of toElevenLabsClientTools()) walk(tool.parameters, tool.name);
    expect(seen).toEqual([]);
  });

  it('uses the same names, descriptions and properties as the Anthropic adapter (no drift)', () => {
    const anthropic = toAnthropicTools();
    const eleven = toElevenLabsClientTools();
    expect(eleven.map((t) => t.name)).toEqual(anthropic.map((t) => t.name));
    for (const [i, tool] of eleven.entries()) {
      expect(tool.description).toBe(anthropic[i].description);
      // Same contract, minus the one key ElevenLabs forbids.
      const { additionalProperties: _drop, ...expected } = anthropic[i].input_schema as unknown as Record<
        string,
        unknown
      >;
      expect(tool.parameters).toEqual(expected);
    }
  });
});
