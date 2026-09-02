/**
 * kilimo-tools.ts — the SINGLE source of truth for every tool exposed to
 * both the Claude text chat (Anthropic Messages API tool-use loop in
 * services/api) and the ElevenLabs voice agent (client tools registered via
 * scripts/print-elevenlabs-tools.mjs). Never define a tool anywhere else:
 * provider-shaped payloads are GENERATED from KILIMO_TOOLS below, so the two
 * channels cannot drift.
 *
 * Tool kinds:
 *  - 'ui'   → executed in the browser (camera, layers, result card) via
 *             runMavunoAction; the server answers the tool call with
 *             { ok: true, note: 'dispatched to map' } so the agent loop
 *             never stalls.
 *  - 'data' → executed on the server (services/api tools/executor.ts) against
 *             the deterministic eligibility engine and data provider.
 *
 * Schema shape follows the battle-tested God's Eye View realtime tool schemas
 * (references/gods-eye-view/vite.config.js, MIT — see apps/globe/NOTICE.md):
 * strict JSON Schema objects with additionalProperties:false and explicit
 * required arrays.
 */

export type ToolKind = 'ui' | 'data';

/** Minimal JSON Schema shape we allow for tool inputs (kept strict on purpose). */
export interface KilimoToolInputSchema {
  readonly type: 'object';
  readonly additionalProperties: false;
  readonly properties: Readonly<Record<string, unknown>>;
  readonly required: readonly string[];
}

export interface KilimoTool {
  readonly name: string;
  readonly description: string;
  readonly kind: ToolKind;
  readonly inputSchema: KilimoToolInputSchema;
}

/**
 * The canonical tool registry. Exactly 8 tools: 3 UI + 5 data.
 * Descriptions are written FOR THE MODEL: they say when to call the tool and
 * when not to.
 */
export const KILIMO_TOOLS = [
  // ── UI tools (browser-executed) ────────────────────────────────────────────
  {
    name: 'fly_to_location',
    description:
      'Fly the cinematic globe camera to a place in Kenya. ALWAYS call this BEFORE ' +
      'discussing a specific place so the map shows what you are talking about — ' +
      'fly first, then speak. target accepts a Kandara ward name ' +
      "(Ng'araria, Muruka, Kagundu-ini, Gaichanjiru, Ithiru, Ruchu), a county name " +
      "(e.g. \"Murang'a\"), or a depot id or name (e.g. \"ncpb-sagana\", " +
      '"NCPB Sagana Depot"). Optionally set altitudeMeters only when the user asks ' +
      'for a specific height or when framing a single depot up close. Do NOT call ' +
      'this for questions with no geographic subject, and do not repeat it when the ' +
      'camera is already at the requested target.',
    kind: 'ui',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        target: {
          type: 'string',
          description:
            'Ward name, county name, or depot id/name to fly to, e.g. ' +
            '"Ng\'araria", "Murang\'a", or "ncpb-sagana".',
        },
        altitudeMeters: {
          type: 'number',
          minimum: 200,
          maximum: 20000000,
          description:
            'Optional camera altitude in meters. Omit for automatic framing of the ' +
            'ward/county/depot.',
        },
      },
      required: ['target'],
    },
  },
  {
    name: 'set_layer_visibility',
    description:
      'Show or hide one map data layer on the globe. Call this so the visible ' +
      'layers match the topic you are explaining: "wards" (Murang\'a/Kandara ward ' +
      'boundaries), "programme" (subsidy programme rules card), "prices" ' +
      '(subsidized vs market price layer), "depots" (distribution depot markers ' +
      'with stock status), "farmers" (synthetic farmer token markers, SIMULATED). ' +
      'Enable a layer BEFORE referring to its contents; hide layers that would ' +
      'clutter the current explanation. Do NOT toggle layers unrelated to the ' +
      "user's question, and do not call it again if the layer is already in the " +
      'requested state.',
    kind: 'ui',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        layer: {
          type: 'string',
          enum: ['wards', 'programme', 'prices', 'depots', 'farmers'],
          description: 'The layer to toggle.',
        },
        visible: {
          type: 'boolean',
          description: 'true to show the layer, false to hide it.',
        },
      },
      required: ['layer', 'visible'],
    },
  },
  {
    name: 'show_result_card',
    description:
      'Render the on-screen eligibility result card for a farmer. Call this ' +
      'IMMEDIATELY AFTER evaluate_farmer returns, passing the Decision object from ' +
      "evaluate_farmer's result VERBATIM and UNMODIFIED as the decision argument — " +
      'do not add, remove, reorder, rename, or reword any field. NEVER call this ' +
      'with a Decision you constructed or edited yourself, and never call it ' +
      'without a preceding evaluate_farmer result in this conversation.',
    kind: 'ui',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        decision: {
          type: 'object',
          description:
            'The exact Decision object returned by the evaluate_farmer tool, ' +
            'passed through verbatim (conclusion, eligible, trace, allocation, ' +
            'prices, depot, citations, evaluatedAt, nextAction, sijui).',
        },
      },
      required: ['decision'],
    },
  },

  // ── Data tools (server-executed) ───────────────────────────────────────────
  {
    name: 'get_programme',
    description:
      'Fetch the official National Fertilizer Subsidy Programme (2026 Long Rains) ' +
      'definition: eligibility criteria, allocation formula, source citation, and ' +
      'evidence tags (authority, derivation, freshness). Call this when the user ' +
      'asks what the programme is, what the rules or requirements are, or before ' +
      'explaining any criterion. Do NOT recite programme rules from memory, and do ' +
      'NOT use this to decide whether a farmer qualifies — only evaluate_farmer ' +
      'determines eligibility.',
    kind: 'data',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {},
      required: [],
    },
  },
  {
    name: 'get_price_schedule',
    description:
      'Fetch the gazetted fertilizer price schedule: subsidized price vs market ' +
      'price in KES per 50 kg bag, validity window, allocation caps, and source ' +
      'citation, optionally scoped to a ward. Call this whenever the user asks ' +
      'about cost, savings, or "nitalipa ngapi?". Do NOT quote any price from ' +
      'memory or compute totals from remembered figures — always read them from ' +
      "this tool's result (or from an evaluate_farmer Decision).",
    kind: 'data',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        ward: {
          type: 'string',
          description:
            "Optional ward name to scope the schedule, e.g. \"Ng'araria\". Omit " +
            'for the programme-wide schedule.',
        },
      },
      required: [],
    },
  },
  {
    name: 'get_depots',
    description:
      'Fetch fertilizer distribution depots with coordinates, merchant details, ' +
      'stock_status (in_stock | low | unknown), checked_at freshness timestamps, ' +
      'and classification (official vs SIMULATED), optionally filtered to those ' +
      'serving a ward. Call this when the user asks where to go, what is nearby, ' +
      'or whether stock is available. Report stock_status and checked_at exactly ' +
      'as returned: if stock_status is "unknown" or checked_at is null, say you ' +
      'cannot verify stock — NEVER invent or guess stock levels or freshness.',
    kind: 'data',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        ward: {
          type: 'string',
          description:
            'Optional ward name to filter depots to those serving that ward. Omit ' +
            'to list all depots.',
        },
      },
      required: [],
    },
  },
  {
    name: 'get_farmer',
    description:
      'Look up a synthetic farmer registration token (e.g. "K-001") and return its ' +
      'recorded attributes: ward, register status, national ID linkage, acreage, ' +
      'crop, prior redemptions, and evidence tags. Call this when the user ' +
      'identifies themselves or asks about a token. All tokens are SIMULATED demo ' +
      'records — say so when relevant. Do NOT guess attributes for tokens this ' +
      'tool cannot find, and do NOT infer eligibility from these attributes — ' +
      'eligibility comes only from evaluate_farmer.',
    kind: 'data',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        token: {
          type: 'string',
          description: 'The farmer token code, e.g. "K-001".',
        },
      },
      required: ['token'],
    },
  },
  {
    name: 'evaluate_farmer',
    description:
      'Run the deterministic eligibility engine for a farmer token and return a ' +
      'Decision: conclusion (confirmed | indicated_by_published_rules | ' +
      'cannot_determine), eligible, any missingRequirement, allocation in bags, ' +
      'subsidized vs market price, assigned depot with stock freshness, a ' +
      'per-criterion trace with evidence tags, citations, nextAction, and an ' +
      'optional sijui honesty note. This tool is the ONLY way to determine ' +
      'eligibility: NEVER compute, estimate, or reason out eligibility, ' +
      'allocation, or what a farmer will pay yourself — not even from programme ' +
      'rules and farmer data you already fetched. Call it whenever the user asks ' +
      '"am I eligible?", "nitapata?", how many bags, or what they will pay, then ' +
      "restate the returned Decision VERBATIM in plain language (including its " +
      'sijui text word-for-word when present) and pass the same Decision to ' +
      'show_result_card unmodified.',
    kind: 'data',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        token: {
          type: 'string',
          description: 'The farmer token code to evaluate, e.g. "K-001".',
        },
      },
      required: ['token'],
    },
  },
] as const satisfies readonly KilimoTool[];

/** Union of all tool names, derived from the registry. */
export type KilimoToolName = (typeof KILIMO_TOOLS)[number]['name'];

type UiTool = Extract<(typeof KILIMO_TOOLS)[number], { kind: 'ui' }>;
type DataTool = Extract<(typeof KILIMO_TOOLS)[number], { kind: 'data' }>;

/** Names of browser-executed tools — derived, never hand-listed. */
export const UI_TOOL_NAMES: readonly UiTool['name'][] = KILIMO_TOOLS.filter(
  (t): t is UiTool => t.kind === 'ui',
).map((t) => t.name);

/** Names of server-executed tools — derived, never hand-listed. */
export const DATA_TOOL_NAMES: readonly DataTool['name'][] = KILIMO_TOOLS.filter(
  (t): t is DataTool => t.kind === 'data',
).map((t) => t.name);

export function isUiTool(name: string): name is UiTool['name'] {
  return (UI_TOOL_NAMES as readonly string[]).includes(name);
}

export function isDataTool(name: string): name is DataTool['name'] {
  return (DATA_TOOL_NAMES as readonly string[]).includes(name);
}

/** Anthropic Messages API tool definition shape. */
export interface AnthropicToolDefinition {
  name: string;
  description: string;
  input_schema: KilimoToolInputSchema;
}

/**
 * Generate the `tools` array for the Anthropic Messages API
 * (client.messages.stream({ tools: toAnthropicTools(), ... })).
 * Exactly the keys name / description / input_schema — nothing else.
 */
export function toAnthropicTools(): AnthropicToolDefinition[] {
  return KILIMO_TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema,
  }));
}

/**
 * ElevenLabs Agents client-tool declaration shape.
 *
 * Targeted shape (verified 2026-09-02 against the ElevenLabs Agents Platform
 * docs, https://elevenlabs.io/docs/eleven-agents/customization/tools/client-tools):
 *   { type: 'client', name, description, expects_response, parameters }
 * where `parameters` is a standard JSON Schema object (type/properties/required),
 * and tool + parameter names are case-sensitive and must exactly match the
 * handler names registered via Conversation.startSession({ clientTools }).
 *
 * In the voice path ALL 8 tools are declared as client tools: UI tools run
 * runMavunoAction directly, and data tools fetch('/api/...') from the browser
 * (same server executor as chat). Data tools set expects_response: true so the
 * agent waits for and speaks from the real result; UI tools are fire-and-forget
 * visual actions (expects_response: false) so speech is never blocked on a
 * camera flight.
 */
export interface ElevenLabsClientToolDefinition {
  type: 'client';
  name: string;
  description: string;
  expects_response: boolean;
  parameters: KilimoToolInputSchema;
}

/**
 * Recursively strip `additionalProperties` from a JSON Schema.
 *
 * Anthropic REQUIRES `additionalProperties: false` on tool input schemas;
 * the ElevenLabs Agents API REJECTS the same key with
 * `extra_forbidden: Extra inputs are not permitted` (HTTP 422). The canonical
 * registry keeps the strict Anthropic form and this adapter relaxes it, so the
 * two providers stay generated from one source instead of drifting apart.
 */
function stripAdditionalProperties(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(stripAdditionalProperties);
  if (schema === null || typeof schema !== 'object') return schema;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema as Record<string, unknown>)) {
    if (key === 'additionalProperties') continue;
    out[key] = stripAdditionalProperties(value);
  }
  return out;
}

export function toElevenLabsClientTools(): ElevenLabsClientToolDefinition[] {
  return KILIMO_TOOLS.map((t) => ({
    type: 'client' as const,
    name: t.name,
    description: t.description,
    expects_response: t.kind === 'data',
    parameters: stripAdditionalProperties(t.inputSchema) as typeof t.inputSchema,
  }));
}
