/**
 * Africa's Talking webhook surface.
 *
 * Callback contracts (all `application/x-www-form-urlencoded`):
 *   USSD          POST  sessionId, serviceCode, phoneNumber, text   -> text/plain "CON ..." | "END ..."
 *   Inbound SMS   POST  date, from, to, id, linkId, text, networkCode -> 200, empty body
 *   Delivery      POST  id, status, phoneNumber, networkCode, failureReason, retryCount -> 200
 *
 * Authentication: Africa's Talking does not sign callbacks, so there is nothing to verify
 * cryptographically. The mitigations are an unguessable path segment (`CHANNEL_WEBHOOK_TOKEN`,
 * compared in constant time) plus an IP allowlist at the edge. Confirm current AT source IPs in
 * your dashboard before relying on the allowlist.
 *
 * Every handler answers 200/text even on internal failure: a non-2xx makes AT retry inbound SMS
 * and kills a USSD session with a carrier error rather than showing the user anything.
 */
import {Router, type Request} from 'express';
import {timingSafeEqual} from 'node:crypto';
import {
  advisorySms, fieldReportAckSms, formatMeetingForSms, parseSmsCommand, matchCounty, renderUssd,
  renderUssdPayload, segmentSms, SMS_HELP, upcomingForWard, type UssdEffect
} from '@terramavuno/shared';
import {getMeetingsStore} from './meetings/store.js';
import {loadAfricasTalkingConfig, sendSms, type AfricasTalkingConfig} from './africastalking.js';
import {buildFieldReport, hashIdentity, type FieldReportRecord} from './field-reports.js';
import {InMemoryChannelStore, type ChannelStore} from './channel-store.js';

export interface ChannelDeps {
  store?: ChannelStore;
  config?: AfricasTalkingConfig | null;
  fetchImpl?: typeof fetch;
  /** Injected so tests can assert on outbound sends without a provider. */
  send?: (to: string[], message: string) => Promise<unknown>;
}

const OPT_OUT_ACK = 'TerraMavuno: you will not receive further advisories. Reply START to resume.';
const OPT_IN_ACK = 'TerraMavuno: advisories resumed. Reply STOP to opt out at any time.';

function tokenMatches(supplied: string, expected: string): boolean {
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** AT sends fields with inconsistent casing across products; read either form. */
const field = (req: Request, ...names: string[]): string => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  for (const n of names) {
    const v = body[n] ?? body[n.toLowerCase()] ?? body[n.charAt(0).toUpperCase() + n.slice(1)];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return '';
};

export function createChannelRouter(deps: ChannelDeps = {}): Router {
  const router = Router();
  const store = deps.store ?? new InMemoryChannelStore();
  const config = deps.config !== undefined ? deps.config : loadAfricasTalkingConfig();
  const dispatch = deps.send ?? ((to: string[], message: string) => sendSms(config, to, message, deps.fetchImpl ?? fetch));

  /** Send a body as one or more SMS parts. Never throws into a webhook handler. */
  async function reply(msisdn: string, body: string): Promise<void> {
    try {
      const {parts, encoding, segments} = segmentSms(body);
      for (const part of parts) {
        const result = (await dispatch([msisdn], part)) as
          {skippedReason?: string; providerMessage?: string; recipients?: {status: string; statusCode: number; cost: string}[]} | undefined;
        // Surface a no-op send: without this an unconfigured provider looks identical to success.
        if (result?.skippedReason) { console.warn(`[channels] outbound SMS not sent: ${result.skippedReason}`); continue; }
        // Status and cost only — never the recipient number.
        const outcome = result?.recipients?.map(r => `${r.status}(${r.statusCode}) ${r.cost}`).join('; ');
        console.log(`[channels] outbound SMS ${encoding} ${segments} segment(s)${outcome ? `: ${outcome}` : result?.providerMessage ? `: ${result.providerMessage}` : ''}`);
      }
    } catch (err) {
      // Deliberately does not log the MSISDN.
      console.error('[channels] outbound SMS failed:', err instanceof Error ? err.message : err);
    }
  }

  router.use('/:token', (req, res, next) => {
    const expected = process.env.CHANNEL_WEBHOOK_TOKEN?.trim();
    if (!expected) return res.status(503).type('text/plain').send('Channel webhooks disabled: set CHANNEL_WEBHOOK_TOKEN');
    if (!tokenMatches(req.params.token, expected)) return res.status(404).type('text/plain').send('Not found');
    return next();
  });

  // ---- USSD ---------------------------------------------------------------
  router.post('/:token/ussd', async (req, res) => {
    const sessionId = field(req, 'sessionId');
    const phoneNumber = field(req, 'phoneNumber');
    const text = field(req, 'text');
    try {
      const response = renderUssd(text);
      // Reply first: the carrier session is short-lived and the effect must not delay the screen.
      res.status(200).type('text/plain').send(renderUssdPayload(response));

      const identityHash = hashIdentity(phoneNumber);
      const {id} = await store.openConversation('ussd', identityHash, sessionId);
      if (sessionId) await store.touchSession(id, sessionId);
      if (response.effect) {
        await applyEffect(response.effect, {
          conversationId: id, identityHash, phoneNumber, channel: 'ussd',
          // Session id plus the exact input path: a retried callback for the same screen is the
          // same report, and must not be stored twice.
          sourceRecordId: sessionId ? `ussd:${sessionId}:${text}` : undefined
        });
      }
    } catch (err) {
      console.error('[channels] ussd handler failed:', err instanceof Error ? err.message : err);
      if (!res.headersSent) res.status(200).type('text/plain').send('END Service temporarily unavailable. Please try again.');
    }
  });

  // ---- Inbound SMS --------------------------------------------------------
  router.post('/:token/sms/inbound', async (req, res) => {
    const from = field(req, 'from');
    const text = field(req, 'text');
    const linkId = field(req, 'linkId');
    const messageId = field(req, 'id');
    res.status(200).type('text/plain').send('');
    try {
      const identityHash = hashIdentity(from);
      const {id} = await store.openConversation('sms', identityHash, linkId || undefined);
      if (linkId) await store.touchSession(id, linkId);
      const command = parseSmsCommand(text);

      if (command.kind === 'opt_out') {
        await store.setOptedOut(identityHash, true);
        return void reply(from, OPT_OUT_ACK);
      }
      if (/^start\b/i.test(text.trim())) {
        await store.setOptedOut(identityHash, false);
        return void reply(from, OPT_IN_ACK);
      }
      if (await store.isOptedOut(identityHash)) return; // Honour the opt-out; do not answer at all.

      if (command.kind === 'report') {
        const county = matchCounty(command.county ?? '');
        if (!county) return void reply(from, `TerraMavuno: county not recognised. Try REPORT <county> <what you see>, e.g. REPORT Makueni rains failed.`);
        const record = buildFieldReport({
          channel: 'sms', location: county.name,
          observation: command.note?.trim() || 'Field report sent by SMS with no detail',
          reporter_ref: identityHash, confidence: 'unknown',
          // AT re-posts inbound SMS if a callback does not return 2xx; its message id makes the
          // write idempotent so a retry does not become a second report.
          source_record_id: messageId ? `sms:${messageId}` : undefined
        });
        const result = await store.saveFieldReport(id, record);
        // A retry means the farmer already got an acknowledgement; sending another would bill us
        // twice and read as if the report was filed twice.
        if (result.duplicate) return void console.log('[channels] ignored duplicate inbound SMS (provider retry)');
        return void reply(from, fieldReportAckSms(county.name));
      }
      // MEETING / MKUTANO — the feature-phone route to the meeting calendar. A
      // farmer without a smartphone must not be the last to hear that a
      // collection briefing moved.
      if (command.kind === 'meetings') {
        const ward = (command.county ?? '').trim();
        const {data} = await getMeetingsStore().list();
        const upcoming = upcomingForWard(data, ward.length > 0 ? ward : null);
        if (upcoming.length === 0) {
          return void reply(from, 'TerraMavuno: no meetings scheduled for your ward yet.');
        }
        // One SMS for the next meeting only. Listing all of them would run to
        // several billed segments for information most farmers will not act on.
        return void reply(from, formatMeetingForSms(upcoming[0]!));
      }
      if (command.kind === 'rsvp') {
        // We can read the answer, but not which meeting it is for: SMS carries
        // no thread. Say so rather than guessing at the nearest meeting and
        // recording an attendance the farmer never gave.
        return void reply(
          from,
          'TerraMavuno: reply received. To confirm attendance, answer on WhatsApp or dial the USSD menu - SMS cannot tell us which meeting you mean.'
        );
      }
      if (command.kind === 'outlook') {
        const county = matchCounty(command.county ?? '');
        return void reply(from, county ? advisorySms(county.name) : SMS_HELP);
      }
      return void reply(from, SMS_HELP);
    } catch (err) {
      console.error('[channels] inbound SMS failed:', err instanceof Error ? err.message : err);
    }
  });

  // ---- Delivery reports ---------------------------------------------------
  router.post('/:token/sms/delivery', (req, res) => {
    const status = field(req, 'status');
    const failureReason = field(req, 'failureReason');
    // Message id and status are safe to log; the phone number is not.
    console.log(`[channels] delivery ${field(req, 'id')} status=${status}${failureReason ? ` reason=${failureReason}` : ''}`);
    res.status(200).type('text/plain').send('');
  });

  async function applyEffect(
    effect: UssdEffect,
    ctx: {conversationId: string; identityHash: string; phoneNumber: string; channel: 'ussd'; sourceRecordId?: string}
  ): Promise<void> {
    if (effect.kind === 'sms_advisory') {
      if (await store.isOptedOut(ctx.identityHash)) return;
      return reply(ctx.phoneNumber, advisorySms(effect.county));
    }
    const record: FieldReportRecord = buildFieldReport({
      channel: ctx.channel,
      location: effect.county,
      observation: effect.category.label,
      indicator: effect.category.indicator,
      reporter_ref: ctx.identityHash,
      confidence: 'unknown',
      source_record_id: ctx.sourceRecordId
    });
    const result = await store.saveFieldReport(ctx.conversationId, record);
    if (result.duplicate) console.log('[channels] ignored duplicate ussd report (provider retry)');
  }

  return router;
}
