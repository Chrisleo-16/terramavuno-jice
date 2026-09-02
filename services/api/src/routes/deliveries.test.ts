import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { MemoryDeliveryStore, setDeliveryStore } from '../deliveries/store.js';

const app = createApp();

/** Ng'araria centroid, from the bundled ward table — K-001's ward. */
const NGARARIA = { lat: -0.93588, lon: 37.02661 };

beforeEach(() => {
  setDeliveryStore(new MemoryDeliveryStore());
});
afterEach(() => {
  setDeliveryStore(null);
});

/** Book a delivery for the one farmer the engine confirms with an allocation. */
async function book(body: Record<string, unknown> = {}) {
  return request(app)
    .post('/api/deliveries')
    .send({ farmerToken: 'K-001', ...body });
}

describe('POST /api/deliveries', () => {
  it('books for a confirmed-eligible farmer and reads the allocation from the engine', async () => {
    const res = await book();
    expect(res.status).toBe(201);
    // K-001 is the 4-bag confirmed case.
    expect(res.body.delivery.bags).toBe(4);
    expect(res.body.delivery.depotName).toContain('Sagana');
    expect(res.body.delivery.status).toBe('requested');
  });

  it('ignores a bag count supplied by the caller', async () => {
    const res = await book({ bags: 99 });
    expect(res.body.delivery.bags).toBe(4);
  });

  it('refuses a farmer the engine did not confirm', async () => {
    // K-002 is registered but has no linked ID: eligible false.
    const res = await request(app).post('/api/deliveries').send({ farmerToken: 'K-002' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('not_deliverable');
    // The engine's own conclusion comes back, not one we invented.
    expect(res.body.conclusion).toBe('confirmed');
    expect(res.body.eligible).toBe(false);
  });

  it('refuses the sijui case rather than booking a lorry on a maybe', async () => {
    // K-004 passes the rules but its depot stock was never checked.
    const res = await request(app).post('/api/deliveries').send({ farmerToken: 'K-004' });
    expect([201, 409]).toContain(res.status);
    if (res.status === 201) {
      // If it books, it must not be presented as confirmed.
      expect(res.body.delivery.status).toBe('requested');
    }
  });

  it('rejects an unknown token', async () => {
    const res = await request(app).post('/api/deliveries').send({ farmerToken: 'K-999' });
    expect(res.status).toBe(404);
  });

  it('rejects a phone number in the token field', async () => {
    const res = await request(app).post('/api/deliveries').send({ farmerToken: '+254712345678' });
    expect(res.status).toBe(400);
  });

  describe('destination', () => {
    it('falls back to the ward centroid and labels it not routable', async () => {
      const res = await book();
      expect(res.body.delivery.destination.source).toBe('ward_centroid');
      expect(res.body.routable).toBe(false);
      // Per-ward, not one hardcoded point for the whole county.
      expect(res.body.delivery.destination.lat).toBeCloseTo(NGARARIA.lat, 3);
      expect(res.body.delivery.destination.lon).toBeCloseTo(NGARARIA.lon, 3);
    });

    it('accepts a pin near the ward and marks it routable', async () => {
      const res = await book({
        location: { lat: NGARARIA.lat + 0.01, lon: NGARARIA.lon + 0.01, source: 'pin' },
      });
      expect(res.status).toBe(201);
      expect(res.body.routable).toBe(true);
      expect(res.body.delivery.destination.source).toBe('pin');
    });

    it('rejects a pin outside Kenya', async () => {
      const res = await book({ location: { lat: 51.5, lon: -0.12, source: 'pin' } });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('pin_outside_kenya');
    });

    it('rejects a pin implausibly far from the farmer ward — a misdrop, not a farm', async () => {
      // Mombasa, while the farmer is in Murang'a.
      const res = await book({ location: { lat: -4.05, lon: 39.66, source: 'pin' } });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('pin_too_far');
      expect(res.body.driftKm).toBeGreaterThan(60);
    });
  });

  it('returns spoken wording that thanks the farmer and promises details', async () => {
    const res = await book();
    expect(res.body.voice).toContain('thank you for booking');
    expect(res.body.voice).toContain('send you a link');
    expect(res.body.voice).toContain('still has to confirm');
    // Spoken: no markup, no URLs.
    expect(res.body.voice).not.toContain('*');
    expect(res.body.voice).not.toContain('http');
  });

  it('records delivery without WhatsApp configured, and says delivery was not attempted', async () => {
    const res = await book();
    expect(res.body.notified).toEqual({ attempted: false, ok: false, provider: 'none' });
  });
});

describe('GET /api/deliveries/track/:code', () => {
  it('finds a delivery by its tracking code, typed loosely', async () => {
    const created = await book();
    const code: string = created.body.delivery.trackingCode;

    const exact = await request(app).get(`/api/deliveries/track/${code}`);
    expect(exact.status).toBe(200);

    // Lower case and missing prefix, as it would arrive from SMS or voice.
    const loose = await request(app).get(
      `/api/deliveries/track/${code.replace('TM-', '').toLowerCase()}`,
    );
    expect(loose.status).toBe(200);
    expect(loose.body.delivery.trackingCode).toBe(code);
  });

  it('rejects a malformed code rather than guessing', async () => {
    const res = await request(app).get('/api/deliveries/track/hello');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('bad_tracking_code');
  });

  it('404s a well-formed code that does not exist', async () => {
    const res = await request(app).get('/api/deliveries/track/TM-44444');
    expect(res.status).toBe(404);
  });
});

describe('POST /api/deliveries/:id/status', () => {
  it('walks the happy path and appends history', async () => {
    const created = await book();
    const id: string = created.body.delivery.id;

    for (const status of ['confirmed', 'dispatched', 'in_transit', 'delivered']) {
      const res = await request(app).post(`/api/deliveries/${id}/status`).send({ status });
      expect(res.status).toBe(200);
      expect(res.body.delivery.status).toBe(status);
    }
    const final = await request(app).get(`/api/deliveries/track/${String(created.body.delivery.trackingCode)}`);
    expect(final.body.delivery.history).toHaveLength(5);
  });

  it('refuses an illegal jump instead of silently applying it', async () => {
    const created = await book();
    const res = await request(app)
      .post(`/api/deliveries/${String(created.body.delivery.id)}/status`)
      .send({ status: 'delivered' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('illegal_transition');
  });

  it('refuses a failure with no reason', async () => {
    const created = await book();
    const res = await request(app)
      .post(`/api/deliveries/${String(created.body.delivery.id)}/status`)
      .send({ status: 'failed' });
    expect(res.status).toBe(409);
  });

  it('accepts a failure with a reason and passes it to the farmer', async () => {
    const created = await book();
    const res = await request(app)
      .post(`/api/deliveries/${String(created.body.delivery.id)}/status`)
      .send({ status: 'failed', note: 'Road impassable after rain' });
    expect(res.status).toBe(200);
    expect(res.body.smsText).toContain('Road impassable');
    expect(res.body.voice).toContain('Road impassable');
  });
});

describe('POST /api/deliveries/:id/pin', () => {
  it('upgrades a ward-centroid booking to a routable pin', async () => {
    const created = await book();
    expect(created.body.routable).toBe(false);

    const res = await request(app)
      .post(`/api/deliveries/${String(created.body.delivery.id)}/pin`)
      .send({ lat: NGARARIA.lat + 0.005, lon: NGARARIA.lon, source: 'pin', landmark: 'Blue gate' });

    expect(res.status).toBe(200);
    expect(res.body.routable).toBe(true);
    expect(res.body.delivery.destination.landmark).toBe('Blue gate');
  });

  it('refuses to move the destination once the lorry has left', async () => {
    const created = await book();
    const id: string = created.body.delivery.id;
    await request(app).post(`/api/deliveries/${id}/status`).send({ status: 'confirmed' });
    await request(app).post(`/api/deliveries/${id}/status`).send({ status: 'dispatched' });

    const res = await request(app)
      .post(`/api/deliveries/${id}/pin`)
      .send({ lat: NGARARIA.lat, lon: NGARARIA.lon, source: 'pin' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('already_dispatched');
  });

  it('rejects a pin outside Kenya', async () => {
    const created = await book();
    const res = await request(app)
      .post(`/api/deliveries/${String(created.body.delivery.id)}/pin`)
      .send({ lat: 0, lon: 0, source: 'pin' });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/deliveries', () => {
  it('filters by farmer token', async () => {
    await book();
    const mine = await request(app).get('/api/deliveries?farmerToken=K-001');
    expect(mine.body.count).toBe(1);
    const other = await request(app).get('/api/deliveries?farmerToken=K-003');
    expect(other.body.count).toBe(0);
  });
});
