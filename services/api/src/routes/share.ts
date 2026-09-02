/**
 * share.ts — send a Decision to a farmer's phone as WhatsApp plain text.
 *
 * Provider order:
 *  1. Evolution API (self-hosted): POST {EVOLUTION_API_URL}/message/sendText/
 *     {EVOLUTION_INSTANCE_NAME} with an `apikey` header.
 *  2. WhatsApp Cloud API, when only WHATSAPP_CLOUD_* are set.
 *  3. Nothing configured -> 503 { available: false } so the Share button hides.
 *
 * The formatter is exported separately: it is unit-tested, and the browser
 * reuses it for the zero-risk `wa.me/?text=` deep link.
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { env } from '../env.js';
import type { Decision } from '../shared.js';

/* ------------------------------------------------------------------ */
/* Formatter                                                           */
/* ------------------------------------------------------------------ */

/** WhatsApp renders *single asterisks* as bold. */
const bold = (text: string): string => `*${text}*`;

const KES = (amount: number): string => `KES ${amount.toLocaleString('en-KE')}`;

const CONCLUSION_LABEL: Record<Decision['conclusion'], string> = {
  confirmed: 'CONFIRMED',
  indicated_by_published_rules: 'INDICATED BY PUBLISHED RULES',
  cannot_determine: 'CANNOT DETERMINE',
};

/**
 * Render a Decision as WhatsApp-safe plain text.
 *
 * Rules mirrored from the honesty contract: the conclusion word is the
 * engine's own; unknown stock is stated, never guessed; the sijui sentence is
 * reproduced verbatim; simulated records carry a SIMULATED notice; and a
 * citation footer lists Authority / Derivation / Freshness per source.
 */
export function formatDecisionForWhatsApp(decision: Decision): string {
  const lines: string[] = [];

  lines.push(bold('TerraMavuno — Kilimo, Nitapata?'));
  lines.push('');
  lines.push(`${bold(CONCLUSION_LABEL[decision.conclusion])}`);

  const verdict =
    decision.eligible === true
      ? 'Eligible for the subsidized input.'
      : decision.eligible === false
        ? 'Not eligible for the subsidized input.'
        : 'Eligibility could not be determined.';
  lines.push(verdict);
  lines.push(`Farmer token: ${decision.farmerToken} (${decision.wardName} ward)`);

  if (decision.missingRequirement !== null) {
    lines.push('');
    lines.push(`${bold('Missing requirement:')} ${decision.missingRequirement}`);
  }

  if (decision.allocationBags !== null) {
    lines.push('');
    lines.push(`${bold('Allocation:')} ${String(decision.allocationBags)} bags (50 kg each)`);
  }

  if (decision.pricePerBagKes !== null) {
    const market =
      decision.marketPriceKes !== null ? ` (market ${KES(decision.marketPriceKes)})` : '';
    lines.push(`${bold('Subsidized price:')} ${KES(decision.pricePerBagKes)} per bag${market}`);
    if (decision.savingsKes !== null) {
      lines.push(`${bold('You save:')} ${KES(decision.savingsKes)}`);
    }
  }

  if (decision.depot !== null) {
    lines.push('');
    lines.push(`${bold('Depot:')} ${decision.depot.name}`);
    const { checkedAt, status } = decision.depot.stock;
    lines.push(
      status === 'unknown' || checkedAt === null
        ? 'Stock: UNKNOWN — today’s stock could not be verified.'
        : `Stock checked: ${checkedAt} (${status})`,
    );
  }

  if (decision.sijui !== null) {
    lines.push('');
    lines.push(decision.sijui);
  }

  lines.push('');
  lines.push(`${bold('Next action:')} ${decision.nextAction}`);

  lines.push('');
  lines.push(`Evaluated at ${decision.evaluatedAt}`);
  if (decision.dataMode !== undefined) {
    lines.push(
      decision.dataMode === 'bundled'
        ? 'Data source: bundled offline snapshot.'
        : 'Data source: live database.',
    );
  }

  if (decision.citations.length > 0) {
    lines.push('');
    lines.push(bold('Sources'));
    for (const tag of decision.citations) {
      const freshness =
        tag.freshness.checkedAt === null
          ? tag.freshness.status
          : `${tag.freshness.status}, checked ${tag.freshness.checkedAt}`;
      lines.push(`- ${tag.citation} [${tag.authority} / ${tag.derivation} / ${freshness}]`);
    }
  }

  if (isSimulated(decision)) {
    lines.push('');
    lines.push(
      bold('SIMULATED') +
        ' — this decision uses synthetic demo records (farmer token, and/or a simulated depot). Confirm with your ward agricultural office before travelling.',
    );
  }

  return lines.join('\n');
}

/** Any simulated derivation, or a simulated depot, triggers the notice. */
export function isSimulated(decision: Decision): boolean {
  if (decision.depot?.classification === 'simulated') return true;
  return decision.citations.some((c) => c.derivation === 'simulated');
}

/** `wa.me` deep link — needs no credentials at all, so it always works. */
export function waMeLink(decision: Decision, phone?: string): string {
  const text = encodeURIComponent(formatDecisionForWhatsApp(decision));
  const digits = phone === undefined ? '' : phone.replace(/\D/g, '');
  return digits.length > 0 ? `https://wa.me/${digits}?text=${text}` : `https://wa.me/?text=${text}`;
}

/* ------------------------------------------------------------------ */
/* Provider selection                                                  */
/* ------------------------------------------------------------------ */

export type ShareProvider = 'evolution' | 'whatsapp_cloud' | 'none';

export function activeShareProvider(): ShareProvider {
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

/** E.164 digits, no '+' — both providers want the bare number. */
export function normalisePhone(phone: string): string {
  return phone.replace(/\D/g, '');
}

/* ------------------------------------------------------------------ */
/* Routes                                                              */
/* ------------------------------------------------------------------ */

/**
 * Body validation. The Decision is accepted loosely — it is produced by our
 * own engine, and the formatter only reads known fields — but the handful of
 * fields the formatter depends on are required so a malformed payload fails
 * fast with a 400 instead of printing "undefined" to a farmer's phone.
 */
const shareBody = z.object({
  phone: z.string().trim().min(7).max(20),
  decision: z
    .object({
      farmerToken: z.string(),
      wardName: z.string(),
      conclusion: z.enum(['confirmed', 'indicated_by_published_rules', 'cannot_determine']),
      eligible: z.boolean().nullable(),
      nextAction: z.string(),
      evaluatedAt: z.string(),
      citations: z.array(z.unknown()).default([]),
    })
    .loose(),
});

export const SHARE_TIMEOUT_MS = 8000;

export const shareRouter: Router = Router();

/** GET /api/share/health — is the Share button allowed to appear? */
shareRouter.get('/health', (_req: Request, res: Response) => {
  const provider = activeShareProvider();
  res.json({ available: provider !== 'none', provider });
});

/** POST /api/share/whatsapp { decision, phone } */
shareRouter.post('/whatsapp', async (req: Request, res: Response) => {
  const parsed = shareBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      ok: false,
      error: 'Invalid share request: expected { decision, phone }.',
      details: parsed.error.issues,
    });
    return;
  }

  const decision = parsed.data.decision as unknown as Decision;
  const text = formatDecisionForWhatsApp(decision);
  const phone = normalisePhone(parsed.data.phone);
  const provider = activeShareProvider();

  if (provider === 'none') {
    res.status(503).json({
      ok: false,
      available: false,
      provider,
      reason: 'No WhatsApp provider is configured on the server.',
      // The deep link needs no credentials, so the client can still share.
      waMeLink: waMeLink(decision, phone),
      text,
    });
    return;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SHARE_TIMEOUT_MS);
  try {
    const upstream =
      provider === 'evolution'
        ? await fetch(
            `${env.evolutionApiUrl!.replace(/\/+$/, '')}/message/sendText/${encodeURIComponent(
              env.evolutionInstanceName!,
            )}`,
            {
              method: 'POST',
              headers: {
                'content-type': 'application/json',
                apikey: env.evolutionApiKey!,
              },
              body: JSON.stringify({ number: phone, text }),
              signal: controller.signal,
            },
          )
        : await fetch(
            `https://graph.facebook.com/v20.0/${encodeURIComponent(
              env.whatsappCloudPhoneNumberId!,
            )}/messages`,
            {
              method: 'POST',
              headers: {
                'content-type': 'application/json',
                authorization: `Bearer ${env.whatsappCloudToken!}`,
              },
              body: JSON.stringify({
                messaging_product: 'whatsapp',
                to: phone,
                type: 'text',
                text: { body: text, preview_url: false },
              }),
              signal: controller.signal,
            },
          );

    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => '');
      res.status(502).json({
        ok: false,
        provider,
        error: `WhatsApp provider rejected the message (HTTP ${String(upstream.status)}).`,
        detail: detail.slice(0, 400),
        waMeLink: waMeLink(decision, phone),
      });
      return;
    }

    res.json({ ok: true, provider, sentTo: phone, text });
  } catch (error) {
    res.status(502).json({
      ok: false,
      provider,
      error: controller.signal.aborted
        ? `WhatsApp provider did not respond within ${String(SHARE_TIMEOUT_MS)} ms.`
        : `Could not reach the WhatsApp provider (${error instanceof Error ? error.message : 'unknown error'}).`,
      waMeLink: waMeLink(decision, phone),
    });
  } finally {
    clearTimeout(timer);
  }
});
