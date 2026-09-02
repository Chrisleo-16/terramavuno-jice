import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { MemoryMeetingsStore, seedMeetings, setMeetingsStore } from '../meetings/store.js';
import type { Meeting } from '@terramavuno/shared';

const app = createApp();

/** A meeting far enough out that it is always upcoming. */
function futureMeeting(overrides: Partial<Meeting> = {}): Meeting {
  return {
    id: 'mtg-test',
    title: 'Test briefing',
    agenda: 'Agenda',
    mode: 'physical',
    authority: 'official',
    status: 'scheduled',
    startsAt: new Date(Date.now() + 6 * 86_400_000).toISOString(),
    durationMinutes: 60,
    wardCode: '0539',
    wardName: "Ng'araria",
    location: { venue: 'Kandara Ward Agricultural Office', lat: -0.85, lon: 36.95 },
    joinUrl: null,
    organiser: 'Kandara Ward Agricultural Office',
    citation: 'SIMULATED meeting record.',
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

beforeEach(() => {
  setMeetingsStore(new MemoryMeetingsStore(seedMeetings()));
  delete process.env.OPENWA_API_URL;
  delete process.env.OPENWA_API_KEY;
});

afterEach(() => {
  setMeetingsStore(null);
  vi.restoreAllMocks();
  delete process.env.OPENWA_API_URL;
  delete process.env.OPENWA_API_KEY;
});

describe('GET /api/meetings', () => {
  it('lists upcoming meetings with a dataMode', async () => {
    const res = await request(app).get('/api/meetings');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.dataMode).toBe('bundled');
    expect(res.body.meetings.length).toBeGreaterThan(0);
  });

  it('filters by ward but keeps county-wide meetings', async () => {
    const res = await request(app).get('/api/meetings?ward=0539');
    const wards = res.body.meetings.map((m: Meeting) => m.wardCode);
    expect(wards).toContain('0539');
    expect(wards).toContain(null); // the county-wide forum
    expect(wards).not.toContain('0540');
  });

  it('returns meetings soonest first', async () => {
    const res = await request(app).get('/api/meetings');
    const times = res.body.meetings.map((m: Meeting) => new Date(m.startsAt).getTime());
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it('rejects a bad scope', async () => {
    const res = await request(app).get('/api/meetings?scope=sideways');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid_args');
  });
});

describe('POST /api/meetings', () => {
  const base = {
    title: 'Ward planning meeting',
    mode: 'physical' as const,
    startsAt: new Date(Date.now() + 3 * 86_400_000).toISOString(),
    organiser: 'Kandara Ward Agricultural Office',
    location: { venue: 'Ward Office', lat: -0.85, lon: 36.95 },
  };

  it('schedules a physical meeting', async () => {
    const res = await request(app).post('/api/meetings').send(base);
    expect(res.status).toBe(201);
    expect(res.body.meeting.mode).toBe('physical');
    expect(res.body.meeting.status).toBe('scheduled');
  });

  it('schedules an online meeting with a join link', async () => {
    const res = await request(app)
      .post('/api/meetings')
      .send({
        ...base,
        mode: 'online',
        location: null,
        joinUrl: 'https://meet.example/xyz',
      });
    expect(res.status).toBe(201);
    expect(res.body.meeting.joinUrl).toBe('https://meet.example/xyz');
  });

  it('refuses a physical meeting with no location', async () => {
    const res = await request(app).post('/api/meetings').send({ ...base, location: null });
    expect(res.status).toBe(400);
  });

  it('refuses an online meeting with no join link', async () => {
    const res = await request(app)
      .post('/api/meetings')
      .send({ ...base, mode: 'online', location: null });
    expect(res.status).toBe(400);
  });

  it('refuses a meeting scheduled in the past', async () => {
    const res = await request(app)
      .post('/api/meetings')
      .send({ ...base, startsAt: new Date(Date.now() - 86_400_000).toISOString() });
    expect(res.status).toBe(400);
  });

  it('defaults to community authority and stamps a community citation', async () => {
    const res = await request(app).post('/api/meetings').send(base);
    expect(res.body.meeting.authority).toBe('community');
    expect(res.body.meeting.citation).toContain('COMMUNITY');
  });

  it('a caller cannot mint an official-looking citation of their own', async () => {
    const res = await request(app)
      .post('/api/meetings')
      .send({ ...base, citation: 'Signed by the Cabinet Secretary' });
    expect(res.body.meeting.citation).not.toContain('Cabinet Secretary');
  });
});

describe('POST /api/meetings/:id/rsvp', () => {
  it('records a yes and returns an acknowledgement', async () => {
    const res = await request(app)
      .post('/api/meetings/mtg-collection-briefing/rsvp')
      .send({ farmerToken: 'K-001', response: 'ndio' });
    expect(res.status).toBe(202);
    expect(res.body.rsvp.response).toBe('yes');
    expect(res.body.acknowledgement).toContain('Confirmed');
  });

  it('never rounds an ambiguous reply up to yes', async () => {
    const res = await request(app)
      .post('/api/meetings/mtg-collection-briefing/rsvp')
      .send({ farmerToken: 'K-001', response: 'perhaps not' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('unparsed_rsvp');
  });

  it('rejects anything that is not an opaque farmer token', async () => {
    const res = await request(app)
      .post('/api/meetings/mtg-collection-briefing/rsvp')
      .send({ farmerToken: '+254712345678', response: 'yes' });
    expect(res.status).toBe(400);
  });

  it('404s for an unknown meeting', async () => {
    const res = await request(app)
      .post('/api/meetings/nope/rsvp')
      .send({ farmerToken: 'K-001', response: 'yes' });
    expect(res.status).toBe(404);
  });

  it('last answer wins when a farmer changes their mind', async () => {
    await request(app)
      .post('/api/meetings/mtg-collection-briefing/rsvp')
      .send({ farmerToken: 'K-001', response: 'yes' });
    await request(app)
      .post('/api/meetings/mtg-collection-briefing/rsvp')
      .send({ farmerToken: 'K-001', response: 'no' });
    const res = await request(app).get('/api/meetings/mtg-collection-briefing');
    expect(res.body.tally).toEqual({ yes: 0, no: 1, maybe: 0 });
  });

  it('still records the RSVP when WhatsApp delivery is impossible', async () => {
    const res = await request(app)
      .post('/api/meetings/mtg-collection-briefing/rsvp')
      .send({ farmerToken: 'K-002', response: 'yes', phone: '+254712345678' });
    expect(res.status).toBe(202);
    expect(res.body.rsvp.response).toBe('yes');
    expect(res.body.delivery.attempted).toBe(true);
    expect(res.body.delivery.ok).toBe(false);
    expect(res.body.delivery.provider).toBe('none');
  });
});

describe('POST /api/meetings/:id/notify', () => {
  it('503s with the message text when no provider is configured', async () => {
    const res = await request(app)
      .post('/api/meetings/mtg-collection-briefing/notify')
      .send({ phones: ['+254712345678'] });
    expect(res.status).toBe(503);
    expect(res.body.available).toBe(false);
    // The caller can still deliver by hand.
    expect(res.body.whatsappText).toContain('Fertilizer collection briefing');
    expect(res.body.smsText).toBeTruthy();
  });

  it('sends via open-wa when OPENWA_API_URL is set', async () => {
    process.env.OPENWA_API_URL = 'http://localhost:8002';
    process.env.OPENWA_API_KEY = 'secret';
    // A Response body is single-use, so mockResolvedValue with one instance
    // would make the SECOND recipient fail on an already-consumed stream.
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(() =>
        Promise.resolve(
          new Response(JSON.stringify({ success: true, response: 'msg-1' }), { status: 200 }),
        ),
      );

    const res = await request(app)
      .post('/api/meetings/mtg-collection-briefing/notify')
      .send({ phones: ['+254712345678', '254700000002'] });

    expect(res.status).toBe(200);
    expect(res.body.provider).toBe('openwa');
    expect(res.body.delivered).toBe(2);

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:8002/sendText');
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer secret');
    // open-wa addresses chats by JID and wraps the payload in `args`.
    expect(JSON.parse(String(init.body))).toEqual({
      args: { to: '254712345678@c.us', content: expect.stringContaining('Fertilizer') },
    });
  });

  it('reports per-recipient failures rather than one boolean', async () => {
    process.env.OPENWA_API_URL = 'http://localhost:8002';
    let call = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      call += 1;
      return Promise.resolve(
        call === 1
          ? new Response(JSON.stringify({ response: 'ok' }), { status: 200 })
          : new Response('number not on WhatsApp', { status: 422 }),
      );
    });

    const res = await request(app)
      .post('/api/meetings/mtg-collection-briefing/notify')
      .send({ phones: ['254700000001', '254700000002'] });

    expect(res.body.delivered).toBe(1);
    expect(res.body.failed).toBe(1);
    expect(res.body.results[1].ok).toBe(false);
    expect(res.body.results[1].error).toContain('not on WhatsApp');
  });

  it('rejects an empty recipient list', async () => {
    const res = await request(app)
      .post('/api/meetings/mtg-collection-briefing/notify')
      .send({ phones: [] });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/meetings/:id/cancel', () => {
  it('cancels rather than deletes, and the notice leads with CANCELLED', async () => {
    const cancel = await request(app).post('/api/meetings/mtg-collection-briefing/cancel').send();
    expect(cancel.status).toBe(200);
    expect(cancel.body.meeting.status).toBe('cancelled');

    // A cancelled meeting drops out of the upcoming list...
    const list = await request(app).get('/api/meetings');
    const ids = list.body.meetings.map((m: Meeting) => m.id);
    expect(ids).not.toContain('mtg-collection-briefing');

    // ...but is still retrievable, so farmers who already travelled can be told.
    const still = await request(app).get('/api/meetings/mtg-collection-briefing');
    expect(still.status).toBe(200);
  });
});

describe('POST /api/meetings/reminders/run', () => {
  it('is idempotent for the same meeting and offset', async () => {
    // Exactly one day out lands on the 1-day reminder offset.
    const store = new MemoryMeetingsStore([
      futureMeeting({ id: 'soon', startsAt: new Date(Date.now() + 86_400_000 + 3600_000).toISOString() }),
    ]);
    setMeetingsStore(store);

    const first = await request(app).post('/api/meetings/reminders/run').send({});
    expect(first.body.due).toBe(1);

    const second = await request(app).post('/api/meetings/reminders/run').send({});
    expect(second.body.due).toBe(0);
  });

  it('says so when it marked reminders sent with no recipients', async () => {
    const store = new MemoryMeetingsStore([
      futureMeeting({ id: 'soon', startsAt: new Date(Date.now() + 86_400_000 + 3600_000).toISOString() }),
    ]);
    setMeetingsStore(store);
    const res = await request(app).post('/api/meetings/reminders/run').send({});
    expect(res.body.note).toContain('no recipient list');
  });
});
