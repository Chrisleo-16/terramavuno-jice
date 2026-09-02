import { describe, expect, it } from 'vitest';
import {
  KENYA_BOUNDS,
  TRACKING_ALPHABET,
  applyStatus,
  canTransition,
  describeLocation,
  distanceKm,
  formatDeliveryForSms,
  formatDeliveryForWhatsApp,
  isRoutable,
  isTerminal,
  isTrackingCode,
  isWithinKenya,
  makeTrackingCode,
  parseTrackingCode,
  statusSentence,
  voiceBookingAcknowledgement,
  voiceMeetingAcknowledgement,
  voiceTrackingUpdate,
  wardCentroidLocation,
} from './deliveries.js';
import type { Delivery, PinnedLocation } from './types.js';
import { septetLength } from '../sms.js';

const PINNED: PinnedLocation = {
  lat: -0.8512,
  lon: 36.9498,
  source: 'pin',
  accuracyMetres: null,
  landmark: 'Blue gate past the church',
};

function delivery(overrides: Partial<Delivery> = {}): Delivery {
  return {
    id: 'del-1',
    trackingCode: 'TM-4K7QD',
    farmerToken: 'K-001',
    wardCode: '0539',
    wardName: "Ng'araria",
    depotId: 'ncpb-sagana',
    depotName: 'NCPB Sagana Depot',
    destination: PINNED,
    bags: 4,
    status: 'requested',
    history: [{ status: 'requested', at: '2026-09-02T09:00:00.000Z', note: null }],
    scheduledFor: null,
    createdAt: '2026-09-02T09:00:00.000Z',
    updatedAt: '2026-09-02T09:00:00.000Z',
    citation: 'SIMULATED delivery record (demo).',
    ...overrides,
  };
}

describe('tracking codes', () => {
  it('uses a voice-safe alphabet with no confusable characters', () => {
    for (const bad of ['0', 'O', '1', 'I', 'L', '2', 'Z', '5', 'S', '8', 'B']) {
      expect(TRACKING_ALPHABET).not.toContain(bad);
    }
  });

  it('generates a valid code', () => {
    const code = makeTrackingCode(() => 0.5);
    expect(isTrackingCode(code)).toBe(true);
    expect(code).toMatch(/^TM-/);
  });

  it('never overflows the alphabet when random() returns its supremum', () => {
    // Math.random() is [0,1), but a bad injected source could hand back 1.
    const code = makeTrackingCode(() => 0.999999999);
    expect(isTrackingCode(code)).toBe(true);
    expect(code).not.toContain('undefined');
  });

  it('repairs the mishearings the alphabet was designed to avoid', () => {
    // A farmer hears "four kay seven queue dee" and types O for 0, I for 1.
    expect(parseTrackingCode('tm-4k7qd')).toBe('TM-4K7QD');
    expect(parseTrackingCode('TM 4K7QD')).toBe('TM-4K7QD');
    expect(parseTrackingCode('4K7QD')).toBe('TM-4K7QD');
  });

  it('rejects a near-miss rather than guessing', () => {
    expect(parseTrackingCode('TM-4K7')).toBeNull();
    expect(parseTrackingCode('')).toBeNull();
    expect(parseTrackingCode('hello')).toBeNull();
  });
});

describe('status machine', () => {
  it('will not let a delivery skip straight from requested to delivered', () => {
    expect(canTransition('requested', 'delivered')).toBe(false);
    const result = applyStatus(delivery(), 'delivered');
    expect(result.ok).toBe(false);
    expect(result.delivery.status).toBe('requested');
  });

  it('walks the happy path', () => {
    let d = delivery();
    for (const next of ['confirmed', 'dispatched', 'in_transit', 'delivered'] as const) {
      const result = applyStatus(d, next);
      expect(result.ok).toBe(true);
      d = result.delivery;
    }
    expect(d.status).toBe('delivered');
    expect(d.history).toHaveLength(5);
  });

  it('appends to history rather than replacing it', () => {
    const result = applyStatus(delivery(), 'confirmed', { at: '2026-09-02T10:00:00.000Z' });
    expect(result.delivery.history.map((h) => h.status)).toEqual(['requested', 'confirmed']);
    expect(result.delivery.updatedAt).toBe('2026-09-02T10:00:00.000Z');
  });

  it('refuses a failure with no reason — a farmer must not be left guessing', () => {
    expect(applyStatus(delivery(), 'failed').ok).toBe(false);
    expect(applyStatus(delivery(), 'failed', { note: '   ' }).ok).toBe(false);
    expect(applyStatus(delivery(), 'failed', { note: 'Road impassable' }).ok).toBe(true);
  });

  it('treats delivered, failed and cancelled as terminal', () => {
    expect(isTerminal('delivered')).toBe(true);
    expect(isTerminal('failed')).toBe(true);
    expect(isTerminal('cancelled')).toBe(true);
    expect(isTerminal('in_transit')).toBe(false);
  });

  it('cannot resurrect a terminal delivery', () => {
    const done = delivery({ status: 'delivered' });
    expect(applyStatus(done, 'in_transit').ok).toBe(false);
  });
});

describe('location honesty', () => {
  it('never describes a ward centroid as the farm', () => {
    const text = describeLocation(wardCentroidLocation(-0.85, 36.95));
    expect(text).toContain('Approximate only');
    expect(text).toContain('not your farm');
  });

  it('a ward centroid is not routable', () => {
    expect(isRoutable(wardCentroidLocation(-0.85, 36.95))).toBe(false);
  });

  it('a dropped pin is routable and keeps the landmark', () => {
    expect(isRoutable(PINNED)).toBe(true);
    expect(describeLocation(PINNED)).toContain('Blue gate past the church');
  });

  it('rejects a GPS fix too coarse to find a farm gate', () => {
    const coarse: PinnedLocation = { ...PINNED, source: 'gps', accuracyMetres: 900 };
    expect(isRoutable(coarse)).toBe(false);
    const fine: PinnedLocation = { ...PINNED, source: 'gps', accuracyMetres: 30 };
    expect(isRoutable(fine)).toBe(true);
    expect(describeLocation(fine)).toContain('30 m');
  });
});

describe('geography guards', () => {
  it('accepts a Kandara pin and rejects one in the ocean', () => {
    expect(isWithinKenya({ lat: -0.85, lon: 36.95 })).toBe(true);
    expect(isWithinKenya({ lat: 0, lon: 0 })).toBe(false);
    expect(isWithinKenya({ lat: 51.5, lon: -0.12 })).toBe(false);
  });

  it('bounds contain Kenya', () => {
    expect(KENYA_BOUNDS.minLat).toBeLessThan(-4);
    expect(KENYA_BOUNDS.maxLat).toBeGreaterThan(5);
  });

  it('measures distance sensibly', () => {
    // Sagana depot to Kandara is a short hop, not hundreds of km.
    const km = distanceKm({ lat: -0.66, lon: 37.2 }, { lat: -0.85, lon: 36.95 });
    expect(km).toBeGreaterThan(10);
    expect(km).toBeLessThan(60);
  });
});

describe('channel wording', () => {
  it('WhatsApp keeps requested distinct from confirmed', () => {
    expect(formatDeliveryForWhatsApp(delivery())).toContain('has not confirmed');
    expect(formatDeliveryForWhatsApp(delivery({ status: 'confirmed' }))).toContain('CONFIRMED');
  });

  it('WhatsApp always offers the tracking route', () => {
    expect(formatDeliveryForWhatsApp(delivery())).toContain('TRACK TM-4K7QD');
  });

  it('SMS fits a single billed segment', () => {
    expect(septetLength(formatDeliveryForSms(delivery()))).toBeLessThanOrEqual(160);
  });

  it('SMS nags for a pin only when the location is not routable', () => {
    const vague = delivery({ destination: wardCentroidLocation(-0.85, 36.95) });
    expect(formatDeliveryForSms(vague)).toContain('Pin your exact location');
    expect(formatDeliveryForSms(delivery())).not.toContain('Pin your exact location');
  });

  it('SMS carries the failure reason', () => {
    const failed = delivery({
      status: 'failed',
      history: [{ status: 'failed', at: '2026-09-02T12:00:00.000Z', note: 'Road impassable' }],
    });
    expect(formatDeliveryForSms(failed)).toContain('Road impassable');
  });

  it('every status has a sentence', () => {
    for (const s of ['requested', 'confirmed', 'dispatched', 'in_transit', 'delivered', 'failed', 'cancelled'] as const) {
      expect(statusSentence(s).length).toBeGreaterThan(0);
    }
  });
});

describe('voice wording', () => {
  it('thanks the farmer and promises details, not a lorry', () => {
    const spoken = voiceBookingAcknowledgement(delivery());
    expect(spoken).toContain('thank you for booking');
    expect(spoken).toContain('send you a link');
    // The promise discipline: the depot still has to confirm.
    expect(spoken).toContain('still has to confirm');
  });

  it('spells the tracking code out so it survives a phone line', () => {
    expect(voiceBookingAcknowledgement(delivery())).toContain('T M - 4 K 7 Q D');
  });

  it('carries no markup or URLs — it is spoken aloud', () => {
    const spoken = voiceBookingAcknowledgement(delivery());
    expect(spoken).not.toContain('*');
    expect(spoken).not.toContain('http');
  });

  it('asks for a pin when it only has a ward centroid', () => {
    const vague = delivery({ destination: wardCentroidLocation(-0.85, 36.95) });
    expect(voiceBookingAcknowledgement(vague)).toContain('pin your exact location');
    expect(voiceBookingAcknowledgement(delivery())).not.toContain('pin your exact location');
  });

  it('meeting acknowledgement uses the same promise wording', () => {
    const spoken = voiceMeetingAcknowledgement('Fertilizer collection briefing', 'Wed 9 Sep, 10:00 EAT');
    expect(spoken).toContain('thank you for booking');
    expect(spoken).toContain('send you a link');
    expect(spoken).toContain('Wed 9 Sep, 10:00 EAT');
  });

  it('tracking update gives the reason on failure and does not promise more updates', () => {
    const failed = delivery({
      status: 'failed',
      history: [{ status: 'failed', at: '2026-09-02T12:00:00.000Z', note: 'Road impassable' }],
    });
    const spoken = voiceTrackingUpdate(failed);
    expect(spoken).toContain('Road impassable');
    expect(spoken).not.toContain('I will message you when it changes');
  });

  it('tracking update promises follow-up while the delivery is live', () => {
    expect(voiceTrackingUpdate(delivery({ status: 'in_transit' }))).toContain(
      'I will message you when it changes',
    );
  });
});
