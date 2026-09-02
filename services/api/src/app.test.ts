/**
 * HTTP-surface tests. The legacy endpoints must keep working, the new Kilimo
 * endpoints must carry dataMode, /health must expose booleans only, and the
 * voice/share routes must degrade to 503 (never 500) when unconfigured.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from './app.js';

beforeAll(() => {
  delete process.env.SUPABASE_URL;
  delete process.env.VITE_SUPABASE_URL;
  delete process.env.SUPABASE_SECRET_KEY;
  delete process.env.ELEVENLABS_API_KEY;
  delete process.env.ELEVENLABS_AGENT_ID;
  delete process.env.EVOLUTION_API_URL;
  delete process.env.EVOLUTION_API_KEY;
  delete process.env.EVOLUTION_INSTANCE_NAME;
  delete process.env.WHATSAPP_CLOUD_ACCESS_TOKEN;
  delete process.env.WHATSAPP_CLOUD_PHONE_NUMBER_ID;
});

describe('legacy endpoints', () => {
  it('is healthy and reports dataMode plus integration booleans only', async () => {
    const r = await request(app).get('/health');
    expect(r.status).toBe(200);
    expect(r.body.dataMode).toBe('bundled');
    expect(typeof r.body.integrations.anthropic).toBe('boolean');
    // No secret may ever appear in a health payload.
    expect(JSON.stringify(r.body)).not.toMatch(/sk-|sbp_|eyJ/);
  });

  it('simulates six options', async () => {
    const r = await request(app)
      .post('/api/simulations')
      .send({
        county: 'Makueni',
        budgetKes: 10_000_000,
        objective: 'drought-resilience',
        horizonYears: 3,
      });
    expect(r.status).toBe(200);
    expect(r.body.options).toHaveLength(6);
  });

  it('exposes both legacy and Kilimo tool schemas', async () => {
    const r = await request(app).get('/api/tools');
    expect(r.status).toBe(200);
    expect(r.body.kilimo.registry).toHaveLength(8);
    expect(r.body.kilimo.anthropic[0]).toHaveProperty('input_schema');
  });
});

describe('kilimo data endpoints', () => {
  it('GET /api/programme returns the rules with dataMode', async () => {
    const r = await request(app).get('/api/programme');
    expect(r.status).toBe(200);
    expect(r.body.dataMode).toBe('bundled');
    expect(r.body.programme.allocationFormula).toEqual({ bagsPerAcre: 2, maxBags: 10 });
  });

  it('GET /api/prices returns the gazetted schedule', async () => {
    const r = await request(app).get('/api/prices');
    expect(r.status).toBe(200);
    expect(r.body.prices[0].subsidizedPriceKes).toBe(2500);
  });

  it('GET /api/depots?ward= sorts nearest-first', async () => {
    const r = await request(app).get('/api/depots').query({ ward: "Ng'araria" });
    expect(r.status).toBe(200);
    expect(r.body.depots.length).toBeGreaterThan(0);
    expect(r.body.depots[0]).toHaveProperty('distanceKm');
  });

  it('GET /api/farmers lists synthetic tokens only', async () => {
    const r = await request(app).get('/api/farmers');
    expect(r.status).toBe(200);
    expect(r.body.farmers.every((f: { token: string }) => /^K-\d{3}$/.test(f.token))).toBe(true);
  });

  it('GET /api/farmers/:token 404s instead of inventing a farmer', async () => {
    expect((await request(app).get('/api/farmers/K-001')).status).toBe(200);
    const missing = await request(app).get('/api/farmers/K-999');
    expect(missing.status).toBe(404);
    expect(missing.body.code).toBe('not_found');
  });

  it('POST /api/evaluate returns the sijui Decision for K-004', async () => {
    const r = await request(app).post('/api/evaluate').send({ token: 'K-004' });
    expect(r.status).toBe(200);
    expect(r.body.decision.conclusion).toBe('indicated_by_published_rules');
    expect(r.body.decision.sijui).toBe(
      "Rules indicate you qualify, but I cannot verify today's stock at this depot.",
    );
  });

  it('POST /api/evaluate rejects a missing token', async () => {
    const r = await request(app).post('/api/evaluate').send({});
    expect(r.status).toBe(400);
  });
});

describe('integration health', () => {
  it('voice degrades to 503 with a reason, never 500', async () => {
    const health = await request(app).get('/api/voice/health');
    expect(health.status).toBe(200);
    expect(health.body.available).toBe(false);

    const signed = await request(app).get('/api/voice/signed-url');
    expect(signed.status).toBe(503);
    expect(signed.body.available).toBe(false);
    expect(signed.body.reason).toContain('ELEVENLABS_API_KEY');
  });

  it('share reports no provider and still offers a wa.me link', async () => {
    const health = await request(app).get('/api/share/health');
    expect(health.body).toEqual({ available: false, provider: 'none' });

    const sent = await request(app)
      .post('/api/share/whatsapp')
      .send({
        phone: '+254700000000',
        decision: {
          farmerToken: 'K-001',
          wardName: "Ng'araria",
          conclusion: 'confirmed',
          eligible: true,
          nextAction: 'Carry your national ID to NCPB Sagana Depot.',
          evaluatedAt: '2026-09-02T07:00:00Z',
          citations: [],
          missingRequirement: null,
          allocationBags: 4,
          pricePerBagKes: 2500,
          marketPriceKes: 6500,
          savingsKes: 16000,
          depot: null,
          trace: [],
          sijui: null,
        },
      });
    expect(sent.status).toBe(503);
    expect(sent.body.waMeLink).toContain('wa.me/254700000000');
  });
});

describe('chat', () => {
  it('rejects a malformed body with a plain 400 (the stream never opens)', async () => {
    const r = await request(app).post('/api/chat').send({ messages: [] });
    expect(r.status).toBe(400);
  });

  it('degrades to an SSE error event when ANTHROPIC_API_KEY is missing', async () => {
    const saved = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    const r = await request(app)
      .post('/api/chat')
      .send({ messages: [{ role: 'user', content: 'Nitapata mbolea?' }] });
    if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved;

    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toContain('text/event-stream');
    expect(r.text).toContain('"type":"error"');
    expect(r.text).toContain('"code":"chat_unavailable"');
    expect(r.text).toContain('"type":"done"');
    // Never a stack trace.
    expect(r.text).not.toContain('at Object.');
  });
});
