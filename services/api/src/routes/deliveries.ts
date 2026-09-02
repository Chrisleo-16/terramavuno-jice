/**
 * deliveries.ts — request a delivery to a pinned location, then track it.
 *
 * Downstream of the eligibility engine and never an input to it: asking for a
 * delivery cannot make anyone eligible. The allocation is read back from the
 * engine rather than accepted from the client, so a farmer cannot request
 * twelve bags by editing a request body.
 *
 * Two honesty rules are enforced here, not left to the UI:
 *   - a location we inferred (ward centroid) is flagged `routable: false` and
 *     every channel says so; a driver is never sent to it as an address
 *   - `requested` is not `confirmed`; only the depot can make that move
 */
import { Router, type Request, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  applyStatus,
  distanceKm,
  formatDeliveryForSms,
  formatDeliveryForWhatsApp,
  isRoutable,
  isWithinKenya,
  makeTrackingCode,
  parseTrackingCode,
  voiceBookingAcknowledgement,
  voiceTrackingUpdate,
  wardCentroidLocation,
  KILIMO_WARDS,
  type Delivery,
  type PinnedLocation,
} from '@terramavuno/shared';
import { executeDataTool } from '../tools/executor.js';
import { getDeliveryStore } from '../deliveries/store.js';
import { activeWhatsAppProvider, sendWhatsAppText } from '../whatsapp.js';

export const deliveriesRouter: Router = Router();

/** Express 5 types a route param as `string | string[]`; ours never repeats. */
function pathParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}

const locationSchema = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  source: z.enum(['pin', 'gps']),
  accuracyMetres: z.number().positive().max(100_000).nullable().default(null),
  landmark: z.string().trim().max(200).nullable().default(null),
});

const createBody = z.object({
  farmerToken: z.string().trim().regex(/^K-\d{3,}$/, 'Expected an opaque farmer token like K-001.'),
  /** Omit to fall back to the ward centroid — which is then labelled as such. */
  location: locationSchema.nullable().default(null),
  phone: z.string().trim().min(7).max(20).optional(),
});

const statusBody = z.object({
  status: z.enum(['confirmed', 'dispatched', 'in_transit', 'delivered', 'failed', 'cancelled']),
  note: z.string().trim().max(500).nullable().default(null),
  phone: z.string().trim().min(7).max(20).optional(),
});

/**
 * A pin more than this far from the farmer's own ward centroid is almost
 * certainly a misdrop — a tap on the wrong part of a zoomed-out globe. We
 * reject rather than dispatch a lorry across the country.
 */
const MAX_PIN_DRIFT_KM = 60;

/**
 * POST /api/deliveries
 *
 * Body: { farmerToken, location?, phone? }
 * The bag count and depot come from the engine, never from the caller.
 */
deliveriesRouter.post('/', async (req: Request, res: Response) => {
  const parsed = createBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      ok: false,
      code: 'invalid_args',
      error: 'Invalid delivery request: expected { farmerToken, location? }.',
      details: parsed.error.issues,
    });
    return;
  }
  const { farmerToken, location, phone } = parsed.data;

  // Read the verdict back from the engine. This is what stops a farmer (or a
  // bug) requesting an allocation the rules never granted.
  const evaluation = await executeDataTool('evaluate_farmer', { token: farmerToken });
  if (!evaluation.ok) {
    res.status(evaluation.code === 'not_found' ? 404 : 400).json(evaluation);
    return;
  }
  const decision = (evaluation.data as { decision?: Record<string, unknown> }).decision;
  if (decision === undefined) {
    res.status(500).json({ ok: false, code: 'engine_error', error: 'No decision returned.' });
    return;
  }

  const eligible = decision.eligible;
  const bags = Number(decision.allocationBags ?? 0);
  const depot = decision.depot as { id?: string; name?: string } | null;

  // Only a confirmed-eligible farmer with an allocation and a depot can book.
  // Everything else gets the engine's own conclusion back, not a refusal we
  // invented.
  if (eligible !== true || bags <= 0 || depot === null || depot === undefined) {
    res.status(409).json({
      ok: false,
      code: 'not_deliverable',
      error:
        'This farmer token does not currently have a confirmed allocation to deliver. See the decision for why.',
      conclusion: decision.conclusion,
      eligible,
      decision,
    });
    return;
  }

  // Resolve the destination. The Decision carries the ward NAME but no
  // coordinates, so the centroid comes from the ward table — using one
  // hardcoded fallback point would put every farmer in the county at the same
  // spot, which is precisely the quiet wrongness this project exists to avoid.
  const ward = KILIMO_WARDS.find(
    (w) => w.code === decision.wardCode || w.name === decision.wardName,
  );
  if (ward === undefined) {
    res.status(422).json({
      ok: false,
      code: 'unknown_ward',
      error:
        'No centroid on record for that ward, so a destination cannot be established. Pin a location to continue.',
      wardName: decision.wardName ?? null,
    });
    return;
  }
  const wardLat = ward.lat;
  const wardLon = ward.lon;
  let destination: PinnedLocation;
  if (location === null) {
    destination = wardCentroidLocation(wardLat, wardLon);
  } else {
    if (!isWithinKenya(location)) {
      res.status(400).json({
        ok: false,
        code: 'pin_outside_kenya',
        error: 'That pin is not inside Kenya. Drop it on your farm and try again.',
      });
      return;
    }
    const drift = distanceKm(location, { lat: wardLat, lon: wardLon });
    if (drift > MAX_PIN_DRIFT_KM) {
      res.status(400).json({
        ok: false,
        code: 'pin_too_far',
        error: `That pin is about ${String(Math.round(drift))} km from your ward. Zoom in and drop it on your farm.`,
        driftKm: Math.round(drift),
      });
      return;
    }
    destination = { ...location };
  }

  const now = new Date().toISOString();
  const delivery: Delivery = {
    id: `del-${randomUUID()}`,
    trackingCode: makeTrackingCode(),
    farmerToken,
    wardCode: (decision.wardCode as string | null) ?? null,
    wardName: (decision.wardName as string | null) ?? null,
    depotId: String(depot.id ?? 'unknown'),
    depotName: String(depot.name ?? 'the depot'),
    destination,
    bags,
    status: 'requested',
    history: [{ status: 'requested', at: now, note: null }],
    scheduledFor: null,
    createdAt: now,
    updatedAt: now,
    citation:
      'SIMULATED delivery record - allocation from the deterministic engine; logistics are a demo, not a live dispatch system.',
  };

  const { data, dataMode } = await getDeliveryStore().create(delivery);

  const delivery_ = data;
  let notified: { attempted: boolean; ok: boolean; provider: string } = {
    attempted: false,
    ok: false,
    provider: activeWhatsAppProvider(),
  };
  if (phone !== undefined) {
    const sent = await sendWhatsAppText(phone, formatDeliveryForWhatsApp(delivery_));
    notified = { attempted: true, ok: sent.ok, provider: sent.provider };
  }

  res.status(201).json({
    ok: true,
    dataMode,
    delivery: delivery_,
    routable: isRoutable(delivery_.destination),
    // The exact words the voice agent should speak back.
    voice: voiceBookingAcknowledgement(delivery_),
    whatsappText: formatDeliveryForWhatsApp(delivery_),
    smsText: formatDeliveryForSms(delivery_),
    notified,
  });
});

/** GET /api/deliveries?farmerToken=K-001 */
deliveriesRouter.get('/', async (req: Request, res: Response) => {
  const token = typeof req.query.farmerToken === 'string' ? req.query.farmerToken : null;
  const { data, dataMode } = await getDeliveryStore().list();
  const deliveries = token === null ? data : data.filter((d) => d.farmerToken === token);
  res.json({ ok: true, dataMode, count: deliveries.length, deliveries });
});

/**
 * GET /api/deliveries/track/:code
 *
 * The farmer-facing lookup. Accepts a code typed loosely (lower case, missing
 * prefix, an O for a zero) because it will arrive from SMS, USSD and voice
 * transcription — but rejects a near-miss rather than guessing at one.
 */
deliveriesRouter.get('/track/:code', async (req: Request, res: Response) => {
  const code = parseTrackingCode(pathParam(req.params.code));
  if (code === null) {
    res.status(400).json({
      ok: false,
      code: 'bad_tracking_code',
      error: 'That does not look like a tracking code. They look like TM-4K7QD.',
    });
    return;
  }
  const { data, dataMode } = await getDeliveryStore().byTrackingCode(code);
  if (data === null) {
    res.status(404).json({ ok: false, code: 'not_found', error: `No delivery with code ${code}.` });
    return;
  }
  res.json({
    ok: true,
    dataMode,
    delivery: data,
    routable: isRoutable(data.destination),
    voice: voiceTrackingUpdate(data),
    smsText: formatDeliveryForSms(data),
  });
});

/**
 * POST /api/deliveries/:id/status — advance the delivery.
 *
 * Illegal transitions are refused with 409 rather than silently applied: a
 * status a farmer was told about must have actually happened.
 */
deliveriesRouter.post('/:id/status', async (req: Request, res: Response) => {
  const parsed = statusBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      ok: false,
      code: 'invalid_args',
      error: 'Invalid status update.',
      details: parsed.error.issues,
    });
    return;
  }

  const store = getDeliveryStore();
  const { data: existing } = await store.get(pathParam(req.params.id));
  if (existing === null) {
    res.status(404).json({ ok: false, code: 'not_found', error: 'No such delivery.' });
    return;
  }

  const result = applyStatus(existing, parsed.data.status, { note: parsed.data.note });
  if (!result.ok) {
    res.status(409).json({
      ok: false,
      code: 'illegal_transition',
      error: result.error,
      from: existing.status,
      to: parsed.data.status,
    });
    return;
  }

  const { data, dataMode } = await store.save(result.delivery);

  let notified = { attempted: false, ok: false, provider: activeWhatsAppProvider() };
  if (parsed.data.phone !== undefined) {
    const sent = await sendWhatsAppText(parsed.data.phone, formatDeliveryForWhatsApp(data));
    notified = { attempted: true, ok: sent.ok, provider: sent.provider };
  }

  res.json({
    ok: true,
    dataMode,
    delivery: data,
    voice: voiceTrackingUpdate(data),
    smsText: formatDeliveryForSms(data),
    notified,
  });
});

/**
 * POST /api/deliveries/:id/pin — attach or correct the destination.
 *
 * Separate from creation because the common flow is voice-first: a farmer
 * books by phone with only a ward centroid, then drops a pin on the map when
 * they next open it.
 */
deliveriesRouter.post('/:id/pin', async (req: Request, res: Response) => {
  const parsed = locationSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      ok: false,
      code: 'invalid_args',
      error: 'Invalid pin: expected { lat, lon, source }.',
      details: parsed.error.issues,
    });
    return;
  }
  if (!isWithinKenya(parsed.data)) {
    res.status(400).json({
      ok: false,
      code: 'pin_outside_kenya',
      error: 'That pin is not inside Kenya.',
    });
    return;
  }

  const store = getDeliveryStore();
  const { data: existing } = await store.get(pathParam(req.params.id));
  if (existing === null) {
    res.status(404).json({ ok: false, code: 'not_found', error: 'No such delivery.' });
    return;
  }
  // Once the lorry has left, moving the destination is a phone call to the
  // driver, not a database write we can honour.
  if (existing.status === 'dispatched' || existing.status === 'in_transit') {
    res.status(409).json({
      ok: false,
      code: 'already_dispatched',
      error: 'This delivery has already left the depot. Call the depot to redirect it.',
    });
    return;
  }

  const updated: Delivery = {
    ...existing,
    destination: { ...parsed.data },
    updatedAt: new Date().toISOString(),
  };
  const { data, dataMode } = await store.save(updated);
  res.json({ ok: true, dataMode, delivery: data, routable: isRoutable(data.destination) });
});
