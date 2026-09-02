/**
 * voiceClient.js — the ElevenLabs Agents voice brain (the flourish; chat is
 * the rehearsed primary).
 *
 * TARGETED SDK: `@elevenlabs/client` 0.x (package.json pins ^0.1.0; verified
 * against the ElevenLabs Agents Platform JS SDK docs, checked 2026-09-02).
 * API used:
 *   import { Conversation } from '@elevenlabs/client';
 *   const conversation = await Conversation.startSession({
 *     signedUrl,                 // from GET /api/voice/signed-url (server-signed)
 *     connectionType: 'websocket', // required from 0.3+, ignored by 0.1/0.2
 *     clientTools: { [toolName]: async (params) => string|void },
 *     onConnect, onDisconnect, onError,
 *     onStatusChange({ status }),   // 'connecting' | 'connected' | 'disconnected'
 *     onModeChange({ mode }),       // 'speaking' | 'listening'
 *   });
 *   await conversation.endSession();
 * Because the pinned range spans versions where `connectionType` was added, the
 * start is retried WITHOUT it if the first attempt rejects — defensive on
 * purpose, so a lockfile bump cannot silently kill voice.
 *
 * Client tools come from the SHARED registry
 * (packages/shared/src/tools/kilimo-tools.ts): UI tools call runAction;
 * DATA tools fetch the REST equivalents and return JSON as a string. EVERY
 * tool handler returns something — a hanging handler would deadlock the agent.
 *
 * Feature flag: if the signed-URL endpoint 503s, errors, or takes over 3 s,
 * voice is switched OFF, #kilimo-mic is disabled with the tooltip
 * "voice unavailable — using chat", and initVoice returns cleanly.
 */

// The shared registry is imported from SOURCE (Vite transpiles the .ts) so
// voice does not depend on `npm run build --workspace @terramavuno/shared`
// having run first — and so tool names can never drift from chat.
import {
  UI_TOOL_NAMES,
  DATA_TOOL_NAMES,
} from '../../../../packages/shared/src/tools/kilimo-tools.ts';

const MIC_ID = 'kilimo-mic';
const SIGNED_URL_ENDPOINT = '/api/voice/signed-url';
const SIGNED_URL_TIMEOUT_MS = 3000;
const UNAVAILABLE_TOOLTIP = 'voice unavailable — using chat';

/** Mic button states reflected in the UI. */
const MIC_STATE_LABEL = {
  idle: 'SEMA',
  connecting: 'CONNECTING',
  listening: 'LISTENING',
  speaking: 'SPEAKING',
  error: 'VOICE ERROR',
};

/** REST equivalents of the 5 server-executed data tools. */
function dataToolRequest(name, params) {
  const token = encodeURIComponent(String(params?.token ?? ''));
  const ward = params?.ward ? `?ward=${encodeURIComponent(String(params.ward))}` : '';
  switch (name) {
    case 'get_programme':
      return { url: '/api/programme', init: { method: 'GET' } };
    case 'get_price_schedule':
      return { url: `/api/prices${ward}`, init: { method: 'GET' } };
    case 'get_depots':
      return { url: `/api/depots${ward}`, init: { method: 'GET' } };
    case 'get_farmer':
      return { url: `/api/farmers/${token}`, init: { method: 'GET' } };
    case 'evaluate_farmer':
      return {
        url: '/api/evaluate',
        init: {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: params?.token ?? null }),
        },
      };
    default:
      return null;
  }
}

/**
 * initVoice — probe the signed URL, then wire the mic button.
 *
 * @param {object} deps
 * @param {(name:string, args:object, runOptions?:object)=>Promise<object>} deps.runAction
 * @param {(decision:object)=>void} [deps.showResultCard]
 * @returns {Promise<{ available:boolean, reason?:string, start?:()=>Promise<void>, stop?:()=>Promise<void> }>}
 */
export async function initVoice({ runAction, showResultCard } = {}) {
  const mic = document.getElementById(MIC_ID);

  const disable = (reason) => {
    if (mic) {
      mic.disabled = true;
      mic.title = UNAVAILABLE_TOOLTIP;
      mic.setAttribute('aria-disabled', 'true');
      const label = mic.querySelector('.kilimo-mic-label');
      if (label) label.textContent = 'CHAT ONLY';
    }
    return { available: false, reason: reason ?? UNAVAILABLE_TOOLTIP };
  };

  // ── Feature-flag probe: signed URL within 3 s, or voice is off ────────────
  let signedUrl = null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SIGNED_URL_TIMEOUT_MS);
    const res = await fetch(SIGNED_URL_ENDPOINT, { signal: controller.signal });
    clearTimeout(timer);
    if (res.status === 503) {
      const body = await res.json().catch(() => null);
      return disable(body?.reason ?? 'voice not configured');
    }
    if (!res.ok) return disable(`signed-url failed (${res.status})`);
    const body = await res.json().catch(() => null);
    // Defensive: sibling may return { signedUrl } or { signed_url } or { url }.
    signedUrl = body?.signedUrl ?? body?.signed_url ?? body?.url ?? null;
    if (!signedUrl) return disable('signed-url response had no URL');
  } catch (error) {
    return disable(error?.name === 'AbortError' ? 'signed-url timed out' : 'signed-url unreachable');
  }

  // ── Lazy-load the SDK so a missing dependency cannot break the globe ──────
  let Conversation;
  try {
    ({ Conversation } = await import('@elevenlabs/client'));
    if (!Conversation?.startSession) return disable('@elevenlabs/client has no Conversation.startSession');
  } catch {
    return disable('@elevenlabs/client is not installed');
  }

  let conversation = null;
  let micState = 'idle';

  const setMicState = (state, detail) => {
    micState = state;
    if (!mic) return;
    mic.classList.toggle('listening', state === 'listening' || state === 'speaking');
    mic.disabled = false;
    const label = mic.querySelector('.kilimo-mic-label');
    if (label) label.textContent = MIC_STATE_LABEL[state] ?? MIC_STATE_LABEL.idle;
    mic.title =
      state === 'error'
        ? `Voice error${detail ? `: ${detail}` : ''} — click to retry, or use chat`
        : state === 'idle'
          ? 'Talk to the Kilimo assistant'
          : `Voice ${state} — click to end`;
    mic.setAttribute('aria-pressed', String(state === 'listening' || state === 'speaking'));
  };

  /** Build the clientTools handler map from the SHARED registry. */
  function buildClientTools() {
    /** @type {Record<string, (params:object)=>Promise<string>>} */
    const tools = {};

    for (const name of UI_TOOL_NAMES) {
      tools[name] = async (params = {}) => {
        try {
          const result = await runAction?.(name, params ?? {}, {});
          // show_result_card renders the same card chat uses; runAction already
          // did it via the injected showResultCard, but a voice-only Decision
          // arriving in a different arg shape is handled here too.
          if (name === 'show_result_card' && result?.ok === false && showResultCard) {
            const decision = params?.decision ?? params;
            if (decision?.conclusion) showResultCard(decision);
          }
          return JSON.stringify(result ?? { ok: true, note: 'dispatched to map' });
        } catch (error) {
          return JSON.stringify({ ok: false, error: describe(error) });
        }
      };
    }

    for (const name of DATA_TOOL_NAMES) {
      tools[name] = async (params = {}) => {
        const request = dataToolRequest(name, params);
        if (!request) return JSON.stringify({ ok: false, error: `no REST route for ${name}` });
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 8000);
        try {
          const res = await fetch(request.url, { ...request.init, signal: controller.signal });
          const text = await res.text();
          if (!res.ok) {
            return JSON.stringify({ ok: false, error: `${name} failed (${res.status})`, body: text.slice(0, 400) });
          }
          // evaluate_farmer feeds the card as well as the agent's speech.
          if (name === 'evaluate_farmer') {
            try {
              const body = JSON.parse(text);
              const decision = body?.decision ?? body?.result ?? body;
              if (decision?.conclusion) showResultCard?.(decision);
            } catch {
              /* the agent still gets the raw text */
            }
          }
          return text; // JSON as a string, per the client-tool contract
        } catch (error) {
          return JSON.stringify({
            ok: false,
            error: error?.name === 'AbortError' ? `${name} timed out` : describe(error),
          });
        } finally {
          clearTimeout(timer);
        }
      };
    }
    return tools;
  }

  async function start() {
    if (conversation) return;
    setMicState('connecting');
    const options = {
      signedUrl,
      clientTools: buildClientTools(),
      onConnect: () => setMicState('listening'),
      onDisconnect: () => {
        conversation = null;
        setMicState('idle');
      },
      onError: (error) => setMicState('error', describe(error)),
      onStatusChange: (payload) => {
        const status = payload?.status ?? payload;
        if (status === 'connecting') setMicState('connecting');
        else if (status === 'connected') setMicState('listening');
        else if (status === 'disconnected') {
          conversation = null;
          setMicState('idle');
        }
      },
      onModeChange: (payload) => {
        const mode = payload?.mode ?? payload;
        if (mode === 'speaking') setMicState('speaking');
        else if (mode === 'listening') setMicState('listening');
      },
    };
    try {
      conversation = await Conversation.startSession({ ...options, connectionType: 'websocket' });
    } catch (firstError) {
      // Older 0.1/0.2 builds reject unknown options — retry without it.
      try {
        conversation = await Conversation.startSession(options);
      } catch (error) {
        conversation = null;
        setMicState('error', describe(error) || describe(firstError));
        return;
      }
    }
  }

  async function stop() {
    const session = conversation;
    conversation = null;
    setMicState('idle');
    try {
      await session?.endSession?.();
    } catch {
      /* teardown is best-effort */
    }
  }

  if (mic) {
    mic.disabled = false;
    mic.title = 'Talk to the Kilimo assistant';
    mic.addEventListener('click', () => {
      if (micState === 'connecting') return;
      if (conversation) void stop();
      else void start();
    });
  }
  setMicState('idle');

  return { available: true, start, stop, state: () => micState };
}

function describe(error) {
  if (!error) return '';
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message || error.name;
  return String(error?.message ?? error?.reason ?? error);
}
