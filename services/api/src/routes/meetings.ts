/**
 * meetings.ts — farmer-facing meeting schedule, RSVP, and WhatsApp delivery.
 *
 * Scope discipline: a meeting is an ANNOUNCEMENT. Nothing in this router can
 * change an eligibility verdict, and none of it goes through the engine. What
 * it does share with the engine is the provenance contract — every meeting
 * carries a citation and an authority label, and a community-organised meeting
 * is never rendered as an official one.
 *
 * Delivery is best-effort and always reported honestly: if WhatsApp is not
 * configured, or the send fails, the RSVP is still recorded and the response
 * says exactly what did and did not happen. We never report a notice as
 * delivered because we managed to write a row.
 */
import { Router, type Request, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  formatMeetingForSms,
  formatMeetingForWhatsApp,
  meetingsDueForReminder,
  parseRsvp,
  rsvpAcknowledgement,
  upcomingForWard,
  type Meeting,
} from '@terramavuno/shared';
import { getMeetingsStore } from '../meetings/store.js';
import { activeWhatsAppProvider, sendWhatsAppText } from '../whatsapp.js';

export const meetingsRouter: Router = Router();

/**
 * Express 5 types a route param as `string | string[]` because a pattern can
 * repeat. Ours cannot, but the type is honest, so narrow it in one place
 * instead of asserting at four call sites.
 */
function pathParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}

const listQuery = z.object({
  ward: z.string().trim().min(1).optional(),
  /** `all` includes past and cancelled meetings; default is upcoming only. */
  scope: z.enum(['upcoming', 'all']).default('upcoming'),
});

const locationSchema = z.object({
  venue: z.string().trim().min(1).max(200),
  lat: z.number().min(-90).max(90).nullable().default(null),
  lon: z.number().min(-180).max(180).nullable().default(null),
});

const createBody = z
  .object({
    title: z.string().trim().min(3).max(120),
    agenda: z.string().trim().max(2000).default(''),
    mode: z.enum(['physical', 'online', 'hybrid']),
    authority: z.enum(['official', 'community']).default('community'),
    startsAt: z.string().datetime({ offset: true }),
    durationMinutes: z.number().int().min(5).max(600).default(60),
    wardCode: z.string().trim().nullable().default(null),
    wardName: z.string().trim().nullable().default(null),
    location: locationSchema.nullable().default(null),
    joinUrl: z.string().url().nullable().default(null),
    organiser: z.string().trim().min(2).max(160),
  })
  .refine((v) => v.mode === 'online' || v.location !== null, {
    message: 'A physical or hybrid meeting needs a location.',
    path: ['location'],
  })
  .refine((v) => v.mode === 'physical' || v.joinUrl !== null, {
    message: 'An online or hybrid meeting needs a joinUrl.',
    path: ['joinUrl'],
  })
  .refine((v) => new Date(v.startsAt).getTime() > Date.now(), {
    message: 'A meeting cannot be scheduled in the past.',
    path: ['startsAt'],
  });

const rsvpBody = z.object({
  farmerToken: z.string().trim().regex(/^K-\d{3,}$/, 'Expected an opaque farmer token like K-001.'),
  response: z.string().trim().min(1),
  /** Optional: send the acknowledgement to WhatsApp too. */
  phone: z.string().trim().min(7).max(20).optional(),
});

const notifyBody = z.object({
  /** Bare numbers or +E.164. Never persisted. */
  phones: z.array(z.string().trim().min(7).max(20)).min(1).max(500),
});

/**
 * A meeting citation must state simulated provenance when the announcement did
 * not come from the programme office. Built here rather than trusted from the
 * request so a caller cannot mint an official-looking notice.
 */
function citationFor(authority: Meeting['authority'], organiser: string): string {
  return authority === 'official'
    ? `Announced by ${organiser}, recorded ${new Date().toISOString().slice(0, 10)}.`
    : `COMMUNITY notice from ${organiser}, self-reported and unverified, recorded ${new Date()
        .toISOString()
        .slice(0, 10)}.`;
}

/** GET /api/meetings?ward=0539&scope=upcoming */
meetingsRouter.get('/', async (req: Request, res: Response) => {
  const parsed = listQuery.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({
      ok: false,
      code: 'invalid_args',
      error: 'Invalid query: expected ?ward=<code>&scope=upcoming|all',
      details: parsed.error.issues,
    });
    return;
  }
  const { data, dataMode } = await getMeetingsStore().list();
  const ward = parsed.data.ward ?? null;
  const meetings =
    parsed.data.scope === 'all'
      ? data.filter((m) => ward === null || m.wardCode === null || m.wardCode === ward)
      : upcomingForWard(data, ward);
  res.json({ ok: true, dataMode, ward, count: meetings.length, meetings });
});

/** GET /api/meetings/:id */
meetingsRouter.get('/:id', async (req: Request, res: Response) => {
  const { data, dataMode } = await getMeetingsStore().get(pathParam(req.params.id));
  if (data === null) {
    res.status(404).json({ ok: false, code: 'not_found', error: 'No such meeting.' });
    return;
  }
  const rsvps = await getMeetingsStore().rsvpsFor(data.id);
  res.json({
    ok: true,
    dataMode,
    meeting: data,
    rsvps: rsvps.data,
    tally: {
      yes: rsvps.data.filter((r) => r.response === 'yes').length,
      no: rsvps.data.filter((r) => r.response === 'no').length,
      maybe: rsvps.data.filter((r) => r.response === 'maybe').length,
    },
  });
});

/** POST /api/meetings — schedule an online or physical meeting. */
meetingsRouter.post('/', async (req: Request, res: Response) => {
  const parsed = createBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      ok: false,
      code: 'invalid_args',
      error: 'Invalid meeting.',
      details: parsed.error.issues,
    });
    return;
  }
  const input = parsed.data;
  const meeting: Meeting = {
    id: `mtg-${randomUUID()}`,
    title: input.title,
    agenda: input.agenda,
    mode: input.mode,
    authority: input.authority,
    status: 'scheduled',
    startsAt: new Date(input.startsAt).toISOString(),
    durationMinutes: input.durationMinutes,
    wardCode: input.wardCode,
    wardName: input.wardName,
    location: input.location,
    joinUrl: input.joinUrl,
    organiser: input.organiser,
    citation: citationFor(input.authority, input.organiser),
    createdAt: new Date().toISOString(),
  };
  const { data, dataMode } = await getMeetingsStore().create(meeting);
  res.status(201).json({ ok: true, dataMode, meeting: data });
});

/** POST /api/meetings/:id/cancel */
meetingsRouter.post('/:id/cancel', async (req: Request, res: Response) => {
  const { data, dataMode } = await getMeetingsStore().cancel(pathParam(req.params.id));
  if (data === null) {
    res.status(404).json({ ok: false, code: 'not_found', error: 'No such meeting.' });
    return;
  }
  res.json({ ok: true, dataMode, meeting: data });
});

/** POST /api/meetings/:id/rsvp { farmerToken, response, phone? } */
meetingsRouter.post('/:id/rsvp', async (req: Request, res: Response) => {
  const parsed = rsvpBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      ok: false,
      code: 'invalid_args',
      error: 'Invalid RSVP: expected { farmerToken, response }.',
      details: parsed.error.issues,
    });
    return;
  }

  const store = getMeetingsStore();
  const { data: meeting } = await store.get(pathParam(req.params.id));
  if (meeting === null) {
    res.status(404).json({ ok: false, code: 'not_found', error: 'No such meeting.' });
    return;
  }

  // An unrecognised reply is never rounded up to 'yes' — a wrongly recorded
  // acceptance is what sends someone travelling for nothing.
  const response = parseRsvp(parsed.data.response);
  if (response === null) {
    res.status(400).json({
      ok: false,
      code: 'unparsed_rsvp',
      error: 'Could not read that as an answer. Reply YES, NO or MAYBE (ndio / hapana / labda).',
    });
    return;
  }

  const { data, dataMode } = await store.rsvp({
    meetingId: meeting.id,
    farmerToken: parsed.data.farmerToken,
    response,
    respondedAt: new Date().toISOString(),
  });

  const acknowledgement = rsvpAcknowledgement(meeting, response);
  let delivery: { attempted: boolean; ok: boolean; provider: string; error?: string } = {
    attempted: false,
    ok: false,
    provider: activeWhatsAppProvider(),
  };
  if (parsed.data.phone !== undefined) {
    const sent = await sendWhatsAppText(parsed.data.phone, acknowledgement);
    delivery = {
      attempted: true,
      ok: sent.ok,
      provider: sent.provider,
      ...(sent.error === undefined ? {} : { error: sent.error }),
    };
  }

  res.status(202).json({ ok: true, dataMode, rsvp: data, acknowledgement, delivery });
});

/**
 * POST /api/meetings/:id/notify { phones: [...] }
 *
 * Fan a meeting notice out over WhatsApp. Reports per-recipient outcomes rather
 * than a single boolean: with a personal-account provider some numbers will
 * fail, and a ward office needs to know which.
 */
meetingsRouter.post('/:id/notify', async (req: Request, res: Response) => {
  const parsed = notifyBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      ok: false,
      code: 'invalid_args',
      error: 'Invalid notify request: expected { phones: [..] }.',
      details: parsed.error.issues,
    });
    return;
  }

  const { data: meeting, dataMode } = await getMeetingsStore().get(pathParam(req.params.id));
  if (meeting === null) {
    res.status(404).json({ ok: false, code: 'not_found', error: 'No such meeting.' });
    return;
  }

  const provider = activeWhatsAppProvider();
  const whatsappText = formatMeetingForWhatsApp(meeting);
  const smsText = formatMeetingForSms(meeting);

  if (provider === 'none') {
    res.status(503).json({
      ok: false,
      available: false,
      provider,
      dataMode,
      reason:
        'No WhatsApp provider is configured. Set OPENWA_API_URL (open-wa) to enable delivery.',
      // The caller can still fall back to SMS or a manual send.
      whatsappText,
      smsText,
    });
    return;
  }

  // Sequential, not Promise.all: open-wa drives one WhatsApp Web session and
  // will drop messages if a burst is fired at it concurrently.
  const results: { phone: string; ok: boolean; id?: string; error?: string }[] = [];
  for (const phone of parsed.data.phones) {
    const sent = await sendWhatsAppText(phone, whatsappText);
    results.push({
      phone,
      ok: sent.ok,
      ...(sent.id === undefined ? {} : { id: sent.id }),
      ...(sent.error === undefined ? {} : { error: sent.error }),
    });
  }

  const delivered = results.filter((r) => r.ok).length;
  res.json({
    ok: delivered > 0,
    provider,
    dataMode,
    meetingId: meeting.id,
    delivered,
    failed: results.length - delivered,
    results,
  });
});

/**
 * POST /api/meetings/reminders/run — dispatch any reminders now due.
 *
 * Idempotent per (meeting, offset): calling it twice in a day does not bill a
 * second round of messages. Intended for a cron hit, but safe to call by hand
 * during a demo.
 */
meetingsRouter.post('/reminders/run', async (req: Request, res: Response) => {
  const store = getMeetingsStore();
  const { data: meetings, dataMode } = await store.list();
  const alreadySent = await store.sentReminders();
  const due = meetingsDueForReminder(meetings, alreadySent);

  const phones = notifyBody.safeParse(req.body).success
    ? (req.body as { phones: string[] }).phones
    : [];

  const dispatched: { meetingId: string; offsetDays: number; delivered: number }[] = [];
  for (const item of due) {
    let delivered = 0;
    const text = formatMeetingForWhatsApp(item.meeting);
    for (const phone of phones) {
      const sent = await sendWhatsAppText(phone, text);
      if (sent.ok) delivered += 1;
    }
    await store.markReminderSent(item.key);
    dispatched.push({ meetingId: item.meeting.id, offsetDays: item.offsetDays, delivered });
  }

  res.json({
    ok: true,
    dataMode,
    provider: activeWhatsAppProvider(),
    due: due.length,
    dispatched,
    ...(phones.length === 0 && due.length > 0
      ? { note: 'Reminders were marked sent but no recipient list was supplied.' }
      : {}),
  });
});

/** GET /api/meetings/health — is meeting delivery wired up? */
export function meetingsHealth(): { available: boolean; provider: string } {
  const provider = activeWhatsAppProvider();
  return { available: provider !== 'none', provider };
}
