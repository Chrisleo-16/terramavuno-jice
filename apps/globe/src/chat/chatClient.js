/**
 * chatClient.js — the Claude text brain.
 *
 * POSTs { messages } to /api/chat and consumes the SSE stream incrementally.
 * Server contract (services/api):
 *   { type:'text_delta',    text }
 *   { type:'tool_start',    name }
 *   { type:'client_action', id, name, args }
 *   { type:'error',         message }
 *   { type:'done' }
 * Defensive double-handling: `text`/`delta`/`content` for deltas, `name`/`tool`
 * for tool names, `args`/`input`/`arguments` (object OR JSON string) for
 * arguments, `message`/`error` for errors, and SSE `event:` lines are accepted
 * as the type when the JSON payload carries none.
 *
 * Invariants: one AbortController per turn (a new send aborts the previous
 * turn), every client_action is dispatched through runAction with
 * { signal, isCurrent, callId }, and errors surface to the UI — never
 * console-only.
 */

const CHAT_ENDPOINT = '/api/chat';
const EVALUATE_ENDPOINT = '/api/evaluate';

/**
 * @param {object} deps
 * @param {(name:string, args:object, runOptions:object)=>Promise<object>} deps.runAction
 * @param {string} [deps.endpoint]
 * @returns {{
 *   send: (text: string, handlers?: object) => Promise<{ok:boolean, error?:string, text?:string}>,
 *   cancel: () => void,
 *   isBusy: () => boolean,
 *   reset: () => void,
 *   history: () => Array<{role:string, content:string}>,
 *   probe: () => Promise<boolean>,
 *   evaluateDirect: (token: string) => Promise<object>,
 * }}
 */
export function createChatClient({ runAction, endpoint = CHAT_ENDPOINT } = {}) {
  /** Multi-turn history sent to the server on every request. */
  const messages = [];
  let turnSeq = 0;
  let activeController = null;

  const cancel = () => {
    if (activeController) {
      activeController.abort();
      activeController = null;
    }
  };

  async function send(userText, handlers = {}) {
    const text = String(userText ?? '').trim();
    if (!text) return { ok: false, error: 'empty message' };

    // A new user turn aborts the previous one (runner gate 4).
    cancel();
    const myTurn = ++turnSeq;
    const controller = new AbortController();
    activeController = controller;
    const isCurrent = () => myTurn === turnSeq;

    messages.push({ role: 'user', content: text });

    const onDelta = typeof handlers.onDelta === 'function' ? handlers.onDelta : () => {};
    const onToolStart = typeof handlers.onToolStart === 'function' ? handlers.onToolStart : () => {};
    const onError = typeof handlers.onError === 'function' ? handlers.onError : () => {};
    const onDone = typeof handlers.onDone === 'function' ? handlers.onDone : () => {};

    let assistantText = '';
    let streamError = null;

    const fail = (message) => {
      streamError = message;
      if (isCurrent()) onError(message);
    };

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify({ messages }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        const detail = await res.text?.().catch(() => '') ?? '';
        fail(
          res.status === 0 || !res.body
            ? 'chat unavailable — the map still works'
            : `chat failed (${res.status})${detail ? `: ${detail.slice(0, 160)}` : ''}`,
        );
        return { ok: false, error: streamError };
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      // Incremental SSE parse: frames are separated by a blank line and a
      // single frame may span chunks or carry several `data:` lines.
      const handleFrame = async (frame) => {
        const lines = frame.split(/\r?\n/);
        let eventName = null;
        const dataLines = [];
        for (const line of lines) {
          if (line.startsWith(':')) continue; // comment / keep-alive
          if (line.startsWith('event:')) eventName = line.slice(6).trim();
          else if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''));
        }
        if (dataLines.length === 0) return;
        const raw = dataLines.join('\n');
        if (raw === '[DONE]') {
          if (isCurrent()) onDone();
          return;
        }
        let payload;
        try {
          payload = JSON.parse(raw);
        } catch {
          // Non-JSON data line: treat it as plain assistant text.
          assistantText += raw;
          if (isCurrent()) onDelta(raw, assistantText);
          return;
        }
        await handleEvent(payload, eventName);
      };

      const handleEvent = async (payload, eventName) => {
        const type = String(payload?.type ?? eventName ?? '');
        switch (type) {
          case 'text_delta':
          case 'text':
          case 'delta': {
            const chunk = String(payload.text ?? payload.delta ?? payload.content ?? '');
            if (!chunk) return;
            assistantText += chunk;
            if (isCurrent()) onDelta(chunk, assistantText);
            return;
          }
          case 'tool_start':
          case 'tool_use': {
            const name = String(payload.name ?? payload.tool ?? 'tool');
            if (isCurrent()) onToolStart(name);
            return;
          }
          case 'client_action':
          case 'ui_action': {
            const name = String(payload.name ?? payload.tool ?? '');
            let args = payload.args ?? payload.input ?? payload.arguments ?? {};
            if (typeof args === 'string') {
              try {
                args = JSON.parse(args);
              } catch {
                args = {};
              }
            }
            if (isCurrent()) onToolStart(name);
            // Every action is dispatched and always resolves (runner gate 3).
            const result = await runAction?.(name, args, {
              signal: controller.signal,
              isCurrent,
              callId: payload.id ?? payload.call_id ?? payload.tool_use_id ?? null,
            });
            if (result && result.ok === false && result.error && !result.superseded && !result.duplicate) {
              console.warn(`[Kilimo] action ${name} failed: ${result.error}`);
            }
            return;
          }
          case 'error': {
            fail(String(payload.message ?? payload.error ?? 'the assistant hit an error'));
            return;
          }
          case 'done':
          case 'end': {
            if (isCurrent()) onDone();
            return;
          }
          default:
            return; // unknown frame types are ignored, never fatal
        }
      };

      // Read loop.
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let sepIndex;
        // Frames end at a blank line (\n\n or \r\n\r\n).
        while ((sepIndex = findFrameEnd(buffer)) !== -1) {
          const frame = buffer.slice(0, sepIndex.start);
          buffer = buffer.slice(sepIndex.end);
          await handleFrame(frame);
        }
        if (!isCurrent()) break; // superseded by a newer turn
      }
      buffer += decoder.decode();
      if (buffer.trim()) await handleFrame(buffer);
    } catch (error) {
      if (error?.name === 'AbortError') {
        return { ok: false, error: 'cancelled' };
      }
      // Network-level failure: /api/chat unreachable.
      fail('chat unavailable — the map still works');
    } finally {
      if (activeController === controller) activeController = null;
    }

    if (assistantText) {
      messages.push({ role: 'assistant', content: assistantText });
    } else if (messages[messages.length - 1]?.role === 'user' && streamError) {
      // Keep history clean when the turn produced nothing.
      messages.pop();
    }
    if (isCurrent()) onDone();
    return streamError ? { ok: false, error: streamError, text: assistantText } : { ok: true, text: assistantText };
  }

  /** Is /api/chat reachable? Used to show the offline banner up front. */
  async function probe() {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2500);
      const res = await fetch(endpoint, { method: 'OPTIONS', signal: controller.signal });
      clearTimeout(timer);
      // Any HTTP answer (even 404/405) means the API process is up.
      return res.status > 0;
    } catch {
      return false;
    }
  }

  /**
   * Demo insurance: evaluate a token straight against the deterministic engine,
   * with no Claude in the loop. Returns the Decision.
   */
  async function evaluateDirect(token) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    try {
      const res = await fetch(EVALUATE_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`evaluate failed (${res.status})`);
      const body = await res.json();
      // Defensive: the sibling may return the Decision bare or wrapped.
      return body?.decision ?? body?.result ?? body;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    send,
    cancel,
    isBusy: () => Boolean(activeController),
    reset: () => {
      cancel();
      messages.length = 0;
    },
    history: () => messages.slice(),
    probe,
    evaluateDirect,
  };
}

/** Locate the end of the next complete SSE frame in the buffer. */
function findFrameEnd(buffer) {
  const lf = buffer.indexOf('\n\n');
  const crlf = buffer.indexOf('\r\n\r\n');
  if (lf === -1 && crlf === -1) return -1;
  if (crlf !== -1 && (lf === -1 || crlf < lf)) return { start: crlf, end: crlf + 4 };
  return { start: lf, end: lf + 2 };
}
