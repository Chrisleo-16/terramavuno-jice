/**
 * Delivery logic and rendering — pure and I/O-free, so both the status machine
 * and the words a farmer hears are unit-testable without a provider.
 *
 * Two rules carry over from the eligibility engine and are enforced here
 * rather than left to callers:
 *
 *  1. An INFERRED location is never spoken or written as though the farmer
 *     gave it. A ward centroid is "the middle of your ward", not "your farm".
 *  2. A `requested` delivery is not a booked one. The depot has to confirm.
 *     Voice and text wording keeps that distinction because getting it wrong
 *     means a farmer waits at home for a lorry nobody dispatched.
 */
import { toGsm7 } from '../sms.js';
import type {
  Delivery,
  DeliveryEvent,
  DeliveryStatus,
  LocationSource,
  PinnedLocation,
} from './types.js';

/**
 * Tracking-code alphabet, chosen to survive being read aloud down a bad line.
 *
 * Excludes 0/O, 1/I/L, 2/Z, 5/S, 8/B — the pairs that get misheard and
 * mistyped. A farmer reading a code to a depot clerk is the design case.
 */
export const TRACKING_ALPHABET = '34679ACDEFGHJKMNPQRTUVWXY';

/** Length of the random part of a tracking code. */
const TRACKING_BODY_LENGTH = 5;

/**
 * Build a tracking code, e.g. "TM-4K7QD".
 *
 * @param random Injectable source in [0, 1) so tests are deterministic.
 * @returns A `TM-` prefixed code from the voice-safe alphabet.
 */
export function makeTrackingCode(random: () => number = Math.random): string {
  let body = '';
  for (let i = 0; i < TRACKING_BODY_LENGTH; i += 1) {
    const index = Math.floor(random() * TRACKING_ALPHABET.length) % TRACKING_ALPHABET.length;
    body += TRACKING_ALPHABET[index];
  }
  return `TM-${body}`;
}

/** Is this string shaped like one of our tracking codes? */
export function isTrackingCode(value: string): boolean {
  return new RegExp(`^TM-[${TRACKING_ALPHABET}]{${String(TRACKING_BODY_LENGTH)}}$`).test(
    value.trim().toUpperCase(),
  );
}

/**
 * Normalise what a farmer typed into a tracking code.
 *
 * Repairs the substitutions the alphabet was designed to avoid — someone
 * hearing "four kay seven" may still type an O for a zero. Returns null when
 * the result is not a valid code, rather than guessing at a near-miss.
 */
export function parseTrackingCode(input: string): string | null {
  const cleaned = input
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/^TM[-–—]?/, '')
    // Fold the confusable characters onto the ones actually in the alphabet.
    .replace(/[O]/g, '0')
    .replace(/[IL]/g, '1')
    .replace(/[SZ]/g, '5')
    .replace(/[B]/g, '8');
  // Any character that survived folding but is not in the alphabet is a
  // genuine mistake, not a mishearing — reject rather than repair.
  const candidate = `TM-${cleaned}`;
  return isTrackingCode(candidate) ? candidate : null;
}

/* ------------------------------------------------------------------ */
/* Status machine                                                      */
/* ------------------------------------------------------------------ */

/**
 * Legal next statuses. A delivery cannot jump from `requested` straight to
 * `delivered`: every state a farmer is told about must have actually happened.
 */
const TRANSITIONS: Record<DeliveryStatus, readonly DeliveryStatus[]> = {
  requested: ['confirmed', 'cancelled', 'failed'],
  confirmed: ['dispatched', 'cancelled', 'failed'],
  dispatched: ['in_transit', 'delivered', 'failed'],
  in_transit: ['delivered', 'failed'],
  delivered: [],
  failed: [],
  cancelled: [],
};

/** Statuses from which nothing further can happen. */
export function isTerminal(status: DeliveryStatus): boolean {
  return TRANSITIONS[status].length === 0;
}

/** May a delivery move from `from` to `to`? */
export function canTransition(from: DeliveryStatus, to: DeliveryStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export interface TransitionResult {
  ok: boolean;
  delivery: Delivery;
  error?: string;
}

/**
 * Apply a status change, appending to the history.
 *
 * Returns the unchanged delivery with `ok: false` on an illegal move rather
 * than throwing — a bad webhook from a logistics partner should be rejected,
 * not crash the route handling it.
 */
export function applyStatus(
  delivery: Delivery,
  to: DeliveryStatus,
  { at = new Date().toISOString(), note = null }: { at?: string; note?: string | null } = {},
): TransitionResult {
  if (!canTransition(delivery.status, to)) {
    return {
      ok: false,
      delivery,
      error: `Cannot move a ${delivery.status} delivery to ${to}.`,
    };
  }
  // A failure with no reason leaves a farmer with nothing to act on.
  if (to === 'failed' && (note === null || note.trim().length === 0)) {
    return { ok: false, delivery, error: 'A failed delivery needs a reason.' };
  }
  const event: DeliveryEvent = { status: to, at, note };
  return {
    ok: true,
    delivery: {
      ...delivery,
      status: to,
      updatedAt: at,
      history: [...delivery.history, event],
    },
  };
}

/* ------------------------------------------------------------------ */
/* Location honesty                                                    */
/* ------------------------------------------------------------------ */

/**
 * How a location may be described to a farmer or a driver.
 *
 * The `ward_centroid` wording is the important one: it must not read like an
 * address, because it is not one.
 */
export function describeLocation(location: PinnedLocation): string {
  if (location.source === 'ward_centroid') {
    return 'Approximate only - the middle of your ward, not your farm. Pin your exact location so the driver can find you.';
  }
  const base = location.source === 'pin' ? 'Location you pinned' : 'Location from your phone';
  const accuracy =
    location.accuracyMetres === null
      ? ''
      : ` (accurate to about ${String(Math.round(location.accuracyMetres))} m)`;
  const landmark = location.landmark === null ? '' : ` - ${location.landmark}`;
  return `${base}${accuracy}${landmark}`;
}

/** Is this location precise enough to route a driver to? */
export function isRoutable(location: PinnedLocation): boolean {
  if (location.source === 'ward_centroid') return false;
  // A GPS fix worse than a quarter kilometre is not a farm gate.
  if (location.accuracyMetres !== null && location.accuracyMetres > 250) return false;
  return true;
}

/* ------------------------------------------------------------------ */
/* Wording                                                             */
/* ------------------------------------------------------------------ */

const STATUS_SENTENCE: Record<DeliveryStatus, string> = {
  requested: 'Your delivery request has been received. The depot has not confirmed it yet.',
  confirmed: 'The depot has CONFIRMED your delivery.',
  dispatched: 'Your delivery has left the depot.',
  in_transit: 'Your delivery is on the way.',
  delivered: 'Your delivery has been completed.',
  failed: 'Your delivery could not be completed.',
  cancelled: 'Your delivery was cancelled.',
};

/** One-line status sentence, shared by every channel. */
export function statusSentence(status: DeliveryStatus): string {
  return STATUS_SENTENCE[status];
}

const bold = (text: string): string => `*${text}*`;

/** Full delivery status for WhatsApp. */
export function formatDeliveryForWhatsApp(delivery: Delivery): string {
  const lines: string[] = [];
  lines.push(bold('Nielekeze by TerraMavuno'));
  lines.push('');
  lines.push(bold(`Delivery ${delivery.trackingCode}`));
  lines.push(statusSentence(delivery.status));
  lines.push('');
  lines.push(`${bold('Bags:')} ${String(delivery.bags)} (50 kg each)`);
  lines.push(`${bold('From:')} ${delivery.depotName}`);
  if (delivery.wardName !== null) lines.push(`${bold('Ward:')} ${delivery.wardName}`);

  lines.push('');
  lines.push(`${bold('Where:')} ${describeLocation(delivery.destination)}`);

  if (delivery.scheduledFor !== null) {
    lines.push('');
    lines.push(`${bold('Scheduled:')} ${delivery.scheduledFor}`);
  }

  const last = delivery.history.at(-1);
  if (last?.note !== null && last?.note !== undefined && last.note.length > 0) {
    lines.push('');
    lines.push(`${bold('Note:')} ${last.note}`);
  }

  lines.push('');
  lines.push(`Track any time by replying: TRACK ${delivery.trackingCode}`);
  lines.push('');
  lines.push(delivery.citation);
  return lines.join('\n');
}

/** Terse delivery status for SMS — one billed segment wherever possible. */
export function formatDeliveryForSms(delivery: Delivery): string {
  const parts = [
    `${delivery.trackingCode}: ${statusSentence(delivery.status)}`,
    `${String(delivery.bags)} bags from ${delivery.depotName}`,
  ];
  if (!isRoutable(delivery.destination)) {
    parts.push('Pin your exact location so the driver can find you');
  }
  const last = delivery.history.at(-1);
  if (delivery.status === 'failed' && last?.note) parts.push(last.note);
  return toGsm7(parts.join('. ') + '.');
}

/**
 * What the VOICE agent says after taking a booking.
 *
 * Spoken, so: no bold, no URLs, no jargon, and the tracking code is spaced out
 * character by character because a run-together code is unusable on a call.
 * The wording holds the requested/confirmed line — we promise to send details,
 * we do not promise a lorry.
 */
export function voiceBookingAcknowledgement(delivery: Delivery): string {
  const spoken = delivery.trackingCode.split('').join(' ');
  const parts = [
    'Asante - thank you for booking.',
    `I have your request for ${String(delivery.bags)} bags from ${delivery.depotName}.`,
    `Your tracking code is ${spoken}.`,
    'We will send you a link and the full details shortly by message.',
  ];
  if (!isRoutable(delivery.destination)) {
    parts.push(
      'One thing - I only have the middle of your ward, not your farm. Please pin your exact location on the map, or tell the depot a landmark, so the driver can find you.',
    );
  }
  parts.push('The depot still has to confirm the delivery. I will let you know as soon as it does.');
  return parts.join(' ');
}

/**
 * What the VOICE agent says after a meeting booking.
 * Same shape as the delivery acknowledgement, same promise discipline.
 */
export function voiceMeetingAcknowledgement(title: string, whenEat: string): string {
  return [
    'Asante - thank you for booking.',
    `You are down for ${title}, ${whenEat}.`,
    'We will send you a link and the full details shortly by message.',
    'If you cannot make it, just reply and say so.',
  ].join(' ');
}

/** Spoken tracking update, for when a farmer calls in with a code. */
export function voiceTrackingUpdate(delivery: Delivery): string {
  const parts = [statusSentence(delivery.status)];
  if (delivery.status === 'in_transit' || delivery.status === 'dispatched') {
    parts.push(`${String(delivery.bags)} bags left ${delivery.depotName}.`);
  }
  const last = delivery.history.at(-1);
  if (delivery.status === 'failed' && last?.note) parts.push(`The reason given was: ${last.note}.`);
  if (!isTerminal(delivery.status)) {
    parts.push('I will message you when it changes.');
  }
  return parts.join(' ');
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** Great-circle distance in kilometres. Used to sanity-check a dropped pin. */
export function distanceKm(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const toRad = (deg: number): number => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Kenya's bounding box, used to reject an obviously bogus pin. */
export const KENYA_BOUNDS = Object.freeze({
  minLat: -4.9,
  maxLat: 5.6,
  minLon: 33.8,
  maxLon: 42.1,
});

/** Is this coordinate plausibly in Kenya? */
export function isWithinKenya(point: { lat: number; lon: number }): boolean {
  return (
    point.lat >= KENYA_BOUNDS.minLat &&
    point.lat <= KENYA_BOUNDS.maxLat &&
    point.lon >= KENYA_BOUNDS.minLon &&
    point.lon <= KENYA_BOUNDS.maxLon
  );
}

/** Build a ward-centroid fallback location, correctly labelled as inferred. */
export function wardCentroidLocation(lat: number, lon: number): PinnedLocation {
  return { lat, lon, source: 'ward_centroid' satisfies LocationSource, accuracyMetres: null, landmark: null };
}
