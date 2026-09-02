/**
 * voice.ts — the ElevenLabs signed-URL broker.
 *
 * ELEVENLABS_API_KEY never leaves this process. The browser receives only a
 * short-lived signed WebSocket URL, which it hands to
 * Conversation.startSession({ signedUrl, clientTools }).
 *
 * Endpoint verified 2026-09-02 against
 * https://elevenlabs.io/docs/api-reference/conversations/get-signed-url :
 *   GET https://api.elevenlabs.io/v1/convai/conversation/get-signed-url
 *       ?agent_id=<id>            (required)
 *   header: xi-api-key: <key>
 *   200 -> { "signed_url": "wss://..." }
 * We normalise that to camelCase { signedUrl } for the browser.
 *
 * Missing configuration returns 503 { available: false, reason } — NEVER a
 * 500 — so the client can feature-flag the mic button off cleanly.
 */
import { Router, type Request, type Response } from 'express';
import { env, integrationFlags } from '../env.js';

export const ELEVENLABS_SIGNED_URL_ENDPOINT =
  'https://api.elevenlabs.io/v1/convai/conversation/get-signed-url';

/** Signed-URL requests must not hang the mic button. */
export const VOICE_TIMEOUT_MS = 5000;

export const voiceRouter: Router = Router();

/** GET /api/voice/health — booleans only, safe for the browser. */
voiceRouter.get('/health', (_req: Request, res: Response) => {
  const flags = integrationFlags();
  res.json({
    available: flags.elevenlabs,
    provider: 'elevenlabs',
    configured: {
      apiKey: env.elevenLabsApiKey !== undefined,
      agentId: env.elevenLabsAgentId !== undefined,
    },
  });
});

/** GET /api/voice/signed-url — brokered signed WebSocket URL. */
voiceRouter.get('/signed-url', async (_req: Request, res: Response) => {
  const apiKey = env.elevenLabsApiKey;
  const agentId = env.elevenLabsAgentId;

  if (apiKey === undefined || agentId === undefined) {
    const missing = [
      apiKey === undefined ? 'ELEVENLABS_API_KEY' : null,
      agentId === undefined ? 'ELEVENLABS_AGENT_ID' : null,
    ].filter((v): v is string => v !== null);
    res.status(503).json({
      available: false,
      reason: `Voice is not configured on the server (missing ${missing.join(' and ')}). Use text chat instead.`,
    });
    return;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), VOICE_TIMEOUT_MS);
  try {
    const url = `${ELEVENLABS_SIGNED_URL_ENDPOINT}?agent_id=${encodeURIComponent(agentId)}`;
    const upstream = await fetch(url, {
      method: 'GET',
      headers: { 'xi-api-key': apiKey, accept: 'application/json' },
      signal: controller.signal,
    });

    if (!upstream.ok) {
      // Upstream refusals are a availability problem for the client, not a
      // server crash: keep it a 503 so the mic button just stays off.
      res.status(503).json({
        available: false,
        reason: `ElevenLabs rejected the signed-URL request (HTTP ${String(upstream.status)}). Use text chat instead.`,
      });
      return;
    }

    const payload = (await upstream.json()) as { signed_url?: unknown; signedUrl?: unknown };
    const signedUrl =
      typeof payload.signed_url === 'string'
        ? payload.signed_url
        : typeof payload.signedUrl === 'string'
          ? payload.signedUrl
          : null;

    if (signedUrl === null) {
      res.status(503).json({
        available: false,
        reason: 'ElevenLabs returned no signed_url. Use text chat instead.',
      });
      return;
    }

    res.json({ available: true, signedUrl, agentConfigured: true });
  } catch (error) {
    const reason = controller.signal.aborted
      ? `ElevenLabs did not respond within ${String(VOICE_TIMEOUT_MS)} ms. Use text chat instead.`
      : `Could not reach ElevenLabs (${error instanceof Error ? error.message : 'unknown error'}). Use text chat instead.`;
    res.status(503).json({ available: false, reason });
  } finally {
    clearTimeout(timer);
  }
});
