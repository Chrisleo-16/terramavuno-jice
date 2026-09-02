/**
 * whatsapp.ts — one place that knows how to put plain text on a WhatsApp
 * number, whichever provider happens to be configured.
 *
 * Provider precedence, and why:
 *   1. open-wa (@open-wa/wa-automate EASY API) — drives an ordinary WhatsApp
 *      account. Preferred for MEETING notices specifically, because the Cloud
 *      API requires a pre-approved template for any business-initiated message
 *      and a ward office announcing a Thursday meeting is exactly that. open-wa
 *      has no template gate.
 *   2. Evolution API (self-hosted) — same idea, different host.
 *   3. WhatsApp Cloud API — official, but template-gated outside the 24-hour
 *      customer service window.
 *   4. Nothing configured — callers get `available: false` and fall back to the
 *      `wa.me` deep link or SMS.
 *
 * This module is deliberately I/O-thin and side-effect free at import time so
 * the routes that use it stay testable with a stubbed `fetch`.
 */
import { env } from './env.js';

export type WhatsAppProvider = 'openwa' | 'evolution' | 'whatsapp_cloud' | 'none';

export const WHATSAPP_TIMEOUT_MS = 8000;

/** Which provider will actually be used for the next send. */
export function activeWhatsAppProvider(): WhatsAppProvider {
  if (env.openWaApiUrl !== undefined) return 'openwa';
  if (
    env.evolutionApiUrl !== undefined &&
    env.evolutionApiKey !== undefined &&
    env.evolutionInstanceName !== undefined
  ) {
    return 'evolution';
  }
  if (env.whatsappCloudToken !== undefined && env.whatsappCloudPhoneNumberId !== undefined) {
    return 'whatsapp_cloud';
  }
  return 'none';
}

/** E.164 digits with no '+'. Every provider here wants the bare number. */
export function normalisePhone(phone: string): string {
  return phone.replace(/\D/g, '');
}

/**
 * open-wa addresses chats by JID, not by bare number.
 * @param phone Digits only.
 * @returns e.g. "254712345678@c.us"
 */
export function toWhatsAppJid(phone: string): string {
  return `${normalisePhone(phone)}@c.us`;
}

export interface SendResult {
  ok: boolean;
  provider: WhatsAppProvider;
  /** Provider message id when it gives us one. */
  id?: string;
  status?: number;
  error?: string;
}

/**
 * Build the request for the active provider.
 * Split out from `sendWhatsAppText` so the shape of each provider's call is
 * unit-testable without performing a send.
 */
export function buildRequest(
  provider: WhatsAppProvider,
  phone: string,
  text: string,
): { url: string; init: RequestInit } | null {
  const digits = normalisePhone(phone);

  if (provider === 'openwa') {
    const base = env.openWaApiUrl!.replace(/\/+$/, '');
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    // The EASY API guards every route with a bearer key when one is set.
    if (env.openWaApiKey !== undefined) headers.Authorization = `Bearer ${env.openWaApiKey}`;
    if (env.openWaSession !== undefined) headers['x-session-id'] = env.openWaSession;
    return {
      url: `${base}/sendText`,
      init: {
        method: 'POST',
        headers,
        // open-wa wraps every EASY API call in an `args` object.
        body: JSON.stringify({ args: { to: toWhatsAppJid(digits), content: text } }),
      },
    };
  }

  if (provider === 'evolution') {
    const base = env.evolutionApiUrl!.replace(/\/+$/, '');
    return {
      url: `${base}/message/sendText/${encodeURIComponent(env.evolutionInstanceName!)}`,
      init: {
        method: 'POST',
        headers: { 'content-type': 'application/json', apikey: env.evolutionApiKey! },
        body: JSON.stringify({ number: digits, text }),
      },
    };
  }

  if (provider === 'whatsapp_cloud') {
    return {
      url: `https://graph.facebook.com/v21.0/${env.whatsappCloudPhoneNumberId!}/messages`,
      init: {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${env.whatsappCloudToken!}`,
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: digits,
          type: 'text',
          text: { body: text },
        }),
      },
    };
  }

  return null;
}

/**
 * Pull a message id out of whatever shape the provider returned.
 * Never throws — an unrecognised success body is still a success.
 */
function extractId(provider: WhatsAppProvider, body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const record = body as Record<string, unknown>;
  if (provider === 'openwa') {
    const response = record.response;
    if (typeof response === 'string') return response;
    if (typeof record.id === 'string') return record.id;
    return undefined;
  }
  if (provider === 'evolution') {
    const key = record.key;
    if (typeof key === 'object' && key !== null) {
      const id = (key as Record<string, unknown>).id;
      if (typeof id === 'string') return id;
    }
    return undefined;
  }
  if (provider === 'whatsapp_cloud') {
    const messages = record.messages;
    if (Array.isArray(messages) && messages.length > 0) {
      const first = messages[0] as Record<string, unknown>;
      if (typeof first.id === 'string') return first.id;
    }
  }
  return undefined;
}

/**
 * Send one plain-text WhatsApp message.
 *
 * Never throws: a messaging failure must not take down the route that
 * triggered it. A farmer's RSVP is still recorded even if the confirmation
 * cannot be delivered.
 */
export async function sendWhatsAppText(phone: string, text: string): Promise<SendResult> {
  const provider = activeWhatsAppProvider();
  if (provider === 'none') {
    return { ok: false, provider, error: 'No WhatsApp provider is configured on the server.' };
  }

  const request = buildRequest(provider, phone, text);
  if (request === null) {
    return { ok: false, provider, error: 'Provider produced no request.' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WHATSAPP_TIMEOUT_MS);
  try {
    const response = await fetch(request.url, { ...request.init, signal: controller.signal });
    const raw = await response.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = raw;
    }
    if (!response.ok) {
      return {
        ok: false,
        provider,
        status: response.status,
        error: raw.slice(0, 300),
      };
    }
    return { ok: true, provider, status: response.status, id: extractId(provider, parsed) };
  } catch (error) {
    const aborted = error instanceof Error && error.name === 'AbortError';
    return {
      ok: false,
      provider,
      error: aborted
        ? `WhatsApp provider did not respond within ${String(WHATSAPP_TIMEOUT_MS)}ms.`
        : String(error instanceof Error ? error.message : error),
    };
  } finally {
    clearTimeout(timer);
  }
}
