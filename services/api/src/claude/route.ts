/**
 * route.ts — POST /api/chat: a MANUAL Claude agentic tool-use loop streamed
 * to the browser over Server-Sent Events.
 *
 * Why manual and not the SDK tool runner: half of our tools execute in the
 * BROWSER (camera, layers, result card). The server cannot run them, but the
 * Messages API requires that every tool_use block be answered before the turn
 * can continue. So for a UI tool we (a) push a `client_action` SSE event to
 * the browser and (b) immediately append a synthetic tool_result. That is
 * God's Eye View's every-call-is-answered invariant, made structural: the loop
 * can never deadlock waiting on a camera flight.
 *
 * Tradeoff, documented deliberately: the ack is optimistic — it confirms the
 * action was DISPATCHED, not that it completed. The system prompt therefore
 * tells the model to report dispatch, and the note text says "dispatched to
 * map" rather than "done".
 *
 * SSE event contract (one JSON object per `data:` line):
 *   { type: 'ready',         model, dataModeHint? }
 *   { type: 'text_delta',    text }
 *   { type: 'tool_start',    name }
 *   { type: 'client_action', id, name, args }
 *   { type: 'tool_result',   name, ok }
 *   { type: 'error',         message, code }
 *   { type: 'done' }
 */
import Anthropic from '@anthropic-ai/sdk';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { env } from '../env.js';
import { executeDataTool } from '../tools/executor.js';
import { isDataTool, isUiTool, toAnthropicTools } from '../shared.js';
import { SYSTEM_PROMPT } from './systemPrompt.js';

/* ------------------------------------------------------------------ */
/* SSE contract                                                        */
/* ------------------------------------------------------------------ */

export type ChatSseEvent =
  | { type: 'ready'; model: string }
  | { type: 'text_delta'; text: string }
  | { type: 'tool_start'; name: string }
  | { type: 'client_action'; id: string; name: string; args: Record<string, unknown> }
  | { type: 'tool_result'; name: string; ok: boolean }
  | { type: 'error'; message: string; code: ChatErrorCode }
  | { type: 'done' };

export type ChatErrorCode =
  | 'chat_unavailable'
  | 'invalid_request'
  | 'upstream_error'
  | 'loop_limit';

/** The optimistic acknowledgement returned for every browser-executed tool. */
export const UI_TOOL_ACK = { ok: true, note: 'dispatched to map' } as const;

/** Safety net on the agentic loop; a demo turn needs far fewer than this. */
export const MAX_LOOP_ITERATIONS = 12;

/** Streaming, so a large max_tokens cannot hit an HTTP timeout. */
export const MAX_TOKENS = 8000;

/* ------------------------------------------------------------------ */
/* Request body                                                        */
/* ------------------------------------------------------------------ */

const bodySchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().min(1),
      }),
    )
    .min(1)
    .max(60),
});

export type ChatRequestBody = z.infer<typeof bodySchema>;

/* ------------------------------------------------------------------ */
/* Pure helpers (unit-tested without any network)                      */
/* ------------------------------------------------------------------ */

/** A tool_use block, reduced to what the loop needs. */
export interface ToolUse {
  id: string;
  name: string;
  /** Read from the STRUCTURED block.input — never string-matched JSON. */
  input: Record<string, unknown>;
}

/** Narrow a content block to a tool_use and normalise its structured input. */
export function readToolUse(block: Anthropic.ContentBlock): ToolUse | null {
  if (block.type !== 'tool_use') return null;
  const input =
    block.input !== null && typeof block.input === 'object' && !Array.isArray(block.input)
      ? (block.input as Record<string, unknown>)
      : {};
  return { id: block.id, name: block.name, input };
}

/**
 * Answer ONE tool_use block. Guarantees a tool_result for every input, which
 * is what keeps the loop alive:
 *  - data tool -> executed server-side, real result;
 *  - UI tool   -> `emit` pushes a client_action to the browser, and the ack
 *                 { ok: true, note: 'dispatched to map' } is returned;
 *  - anything else -> an is_error result telling the model the tool does not
 *                 exist (still an answer, so the turn can continue).
 */
export async function resolveToolUse(
  use: ToolUse,
  emit: (event: ChatSseEvent) => void,
): Promise<Anthropic.ToolResultBlockParam> {
  if (isUiTool(use.name)) {
    emit({ type: 'client_action', id: use.id, name: use.name, args: use.input });
    emit({ type: 'tool_result', name: use.name, ok: true });
    return {
      type: 'tool_result',
      tool_use_id: use.id,
      content: JSON.stringify(UI_TOOL_ACK),
    };
  }

  if (isDataTool(use.name)) {
    const result = await executeDataTool(use.name, use.input);
    emit({ type: 'tool_result', name: use.name, ok: result.ok });
    return {
      type: 'tool_result',
      tool_use_id: use.id,
      content: JSON.stringify(result),
      ...(result.ok ? {} : { is_error: true }),
    };
  }

  emit({ type: 'tool_result', name: use.name, ok: false });
  return {
    type: 'tool_result',
    tool_use_id: use.id,
    is_error: true,
    content: JSON.stringify({
      ok: false,
      code: 'unknown_tool',
      error: `"${use.name}" is not a TerraMavuno tool. Use only the provided tools.`,
    }),
  };
}

/**
 * The request params for one loop iteration.
 *
 * Caching: render order is tools -> system -> messages, so the stable prefix
 * is the tool registry plus the frozen system prompt. The LAST system block
 * carries cache_control ephemeral, which caches everything before it. The
 * system text contains no timestamps or ids, so the prefix is byte-stable
 * across requests and turns.
 */
/**
 * `output_config.effort` is a 5-family parameter. Haiku 4.5 and the other 4.5
 * models REJECT it with a 400 rather than ignoring it, so it cannot be sent
 * unconditionally — the chat model is operator-configurable via
 * ANTHROPIC_MODEL, and a wrong default would break chat entirely.
 *
 * @param model Model id from configuration.
 * @returns True when the model accepts `output_config.effort`.
 */
export function supportsEffort(model: string): boolean {
  // Everything in the Opus/Sonnet/Fable 5 families and Opus 4.6+ takes effort.
  // The 4.5 generation (haiku-4-5, sonnet-4-5) does not.
  return !/-4-5(\b|$)/.test(model);
}

export function buildRequestParams(
  messages: Anthropic.MessageParam[],
  model: string,
): Record<string, unknown> {
  return {
    model,
    max_tokens: MAX_TOKENS,
    // Snappy demo turns: low effort where the model supports it. No
    // temperature or top_p — not supported on the 5 family.
    ...(supportsEffort(model) ? { output_config: { effort: 'low' } } : {}),
    tools: toAnthropicTools(),
    system: [
      {
        type: 'text',
        text: SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages,
  };
}

/* ------------------------------------------------------------------ */
/* SSE plumbing                                                        */
/* ------------------------------------------------------------------ */

function openSse(res: Response): (event: ChatSseEvent) => void {
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  // Defeat proxy buffering so deltas actually arrive incrementally.
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
  return (event: ChatSseEvent): void => {
    if (res.writableEnded) return;
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };
}

/* ------------------------------------------------------------------ */
/* The handler                                                         */
/* ------------------------------------------------------------------ */

/** Lazily constructed so a missing key degrades instead of crashing boot. */
let client: Anthropic | null = null;

function getClient(apiKey: string): Anthropic {
  if (client === null) client = new Anthropic({ apiKey });
  return client;
}

/** Test-only: drop the memoised Anthropic client. */
export function resetAnthropicClient(): void {
  client = null;
}

export async function chatHandler(req: Request, res: Response): Promise<void> {
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) {
    // A malformed body is a plain HTTP error — the stream never opens.
    res.status(400).json({
      error: 'Invalid chat request: expected { messages: [{ role, content }] }.',
      details: parsed.error.issues,
    });
    return;
  }

  const emit = openSse(res);

  const apiKey = env.anthropicApiKey;
  if (apiKey === undefined) {
    // Degrade to "chat unavailable" — never a stack trace, never a crash.
    emit({
      type: 'error',
      code: 'chat_unavailable',
      message:
        'Chat is unavailable: ANTHROPIC_API_KEY is not configured on the server. The map, layers and eligibility engine still work — try the REST endpoints or voice.',
    });
    emit({ type: 'done' });
    res.end();
    return;
  }

  const model = env.anthropicModel;
  emit({ type: 'ready', model });

  const messages: Anthropic.MessageParam[] = parsed.data.messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  // One AbortController per turn: if the browser disconnects mid-flight we
  // stop paying for tokens nobody will see (ported from GEV's per-turn abort).
  const abort = new AbortController();
  req.on('close', () => abort.abort());

  try {
    for (let iteration = 0; iteration < MAX_LOOP_ITERATIONS; iteration += 1) {
      if (abort.signal.aborted) break;

      const stream = getClient(apiKey).messages.stream(
        // Cast: output_config / cache_control are newer request fields than
        // some @anthropic-ai/sdk type releases expose.
        buildRequestParams(messages, model) as Anthropic.MessageStreamParams,
        { signal: abort.signal },
      );
      stream.on('text', (delta: string) => emit({ type: 'text_delta', text: delta }));
      stream.on('contentBlock', (block) => {
        if (block.type === 'tool_use') emit({ type: 'tool_start', name: block.name });
      });

      const message = await stream.finalMessage();

      if (message.stop_reason === 'pause_turn') {
        // A paused turn is resumed by re-sending the accumulated assistant
        // content unchanged; anything else silently truncates the answer.
        messages.push({ role: 'assistant', content: message.content });
        continue;
      }

      if (message.stop_reason !== 'tool_use') break;

      const uses = message.content
        .map(readToolUse)
        .filter((u): u is ToolUse => u !== null);

      messages.push({ role: 'assistant', content: message.content });

      // Every tool_use gets exactly one tool_result, all in ONE user message.
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const use of uses) {
        results.push(await resolveToolUse(use, emit));
      }
      if (results.length === 0) break;
      messages.push({ role: 'user', content: results });

      if (iteration === MAX_LOOP_ITERATIONS - 1) {
        emit({
          type: 'error',
          code: 'loop_limit',
          message: `Stopped after ${MAX_LOOP_ITERATIONS} tool rounds without a final answer. Please rephrase the question.`,
        });
      }
    }
  } catch (error) {
    if (!abort.signal.aborted) {
      emit({ type: 'error', code: 'upstream_error', message: describeError(error) });
    }
  }

  emit({ type: 'done' });
  res.end();
}

/** Safe, user-facing error text. Never a stack trace, never a key. */
export function describeError(error: unknown): string {
  if (error instanceof Anthropic.AuthenticationError) {
    return 'Chat is unavailable: the configured Anthropic API key was rejected.';
  }
  if (error instanceof Anthropic.RateLimitError) {
    return 'Chat is busy (rate limited). Please try again in a moment.';
  }
  if (error instanceof Anthropic.APIError) {
    return `Chat failed upstream (HTTP ${String(error.status ?? 'unknown')}). Please try again.`;
  }
  if (error instanceof Error) return `Chat failed: ${error.message}`;
  return 'Chat failed for an unknown reason.';
}
