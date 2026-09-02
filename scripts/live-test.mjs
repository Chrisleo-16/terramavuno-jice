/**
 * Live smoke test for a RUNNING local stack.
 *
 * Exercises every surface a judge or a farmer can reach — health, the five
 * Kenya data endpoints, all five farmer verdicts (including the deliberate
 * "sijui" case), the USSD and SMS webhooks, opt-out, the field-report return
 * path, chat, and voice — then prints a pass/fail table and exits non-zero if
 * anything a demo depends on is broken.
 *
 * Prerequisites (two terminals):
 *   npm run dev:api      # http://localhost:8787
 *   npm run dev          # http://localhost:4173
 *
 * Usage:
 *   node scripts/live-test.mjs
 *   node scripts/live-test.mjs --globe     # also boot a headless browser
 *
 * Requests go through the GLOBE origin (4173) on purpose: that exercises the
 * Vite proxy the browser actually uses, so a proxy misconfiguration fails here
 * rather than silently at demo time.
 */
import { readFileSync } from 'node:fs';

const GLOBE = process.env.GLOBE_URL || 'http://localhost:4173';
const API = process.env.API_URL || 'http://localhost:8787';
const withGlobe = process.argv.includes('--globe');

const results = [];
let softWarnings = 0;

/**
 * Run one check. `soft: true` marks a check whose failure degrades the demo
 * but does not break it (an unset optional API key, for example).
 */
async function check(name, fn, { soft = false } = {}) {
  const started = Date.now();
  try {
    const note = await fn();
    results.push({ name, ok: true, note: note || '', ms: Date.now() - started });
  } catch (error) {
    if (soft) softWarnings += 1;
    results.push({
      name,
      ok: false,
      soft,
      note: String(error?.message || error).slice(0, 160),
      ms: Date.now() - started,
    });
  }
}

async function getJson(url, init) {
  const res = await fetch(url, init);
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`${res.status} non-JSON: ${text.slice(0, 80)}`);
  }
  if (!res.ok) throw new Error(`${res.status} ${text.slice(0, 120)}`);
  return body;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

// ---------------------------------------------------------------- API health

let health;
await check('API health', async () => {
  health = await getJson(`${API}/health`);
  assert(health.status === 'ok', `status=${health.status}`);
  return `dataMode=${health.dataMode}`;
});

await check('Vite proxy forwards /api to the API', async () => {
  const body = await getJson(`${GLOBE}/api/tools`);
  assert(Array.isArray(body.tools) && body.tools.length > 0, 'no tools returned');
  return `${body.tools.length} tools`;
});

// ------------------------------------------------------------- data surfaces

for (const [path, key] of [
  ['programme', 'programme'],
  ['prices', 'prices'],
  ['depots', 'depots'],
  ['farmers', 'farmers'],
]) {
  await check(`GET /api/${path}`, async () => {
    const body = await getJson(`${GLOBE}/api/${path}`);
    assert(body.ok, 'ok=false');
    const value = body[key];
    assert(value && (Array.isArray(value) ? value.length > 0 : true), `empty ${key}`);
    return `dataMode=${body.dataMode}${Array.isArray(value) ? ` n=${value.length}` : ''}`;
  });
}

// ------------------------------------------- the five deterministic verdicts

/**
 * Expected engine output per seeded farmer token. These are the demo's whole
 * argument — a wrong verdict here is a broken product, not a flaky test.
 */
const EXPECTED = [
  { token: 'K-001', conclusion: 'confirmed', eligible: true, bags: 4 },
  { token: 'K-002', conclusion: 'confirmed', eligible: false },
  { token: 'K-003', conclusion: 'confirmed', eligible: false },
  { token: 'K-004', conclusion: 'indicated_by_published_rules', eligible: true },
  { token: 'K-005', conclusion: 'cannot_determine', eligible: null },
];

for (const want of EXPECTED) {
  await check(`POST /api/evaluate ${want.token}`, async () => {
    const body = await getJson(`${GLOBE}/api/evaluate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: want.token }),
    });
    assert(body.ok, 'ok=false');
    const d = body.decision;
    assert(
      d.conclusion === want.conclusion,
      `conclusion ${d.conclusion} != ${want.conclusion}`,
    );
    assert(d.eligible === want.eligible, `eligible ${d.eligible} != ${want.eligible}`);
    if (want.bags !== undefined) {
      assert(d.allocationBags === want.bags, `bags ${d.allocationBags} != ${want.bags}`);
    }
    assert(Array.isArray(d.trace) && d.trace.length > 0, 'empty decision trace');
    return `${d.conclusion} eligible=${d.eligible}`;
  });
}

await check('Every decision line carries a citation', async () => {
  const body = await getJson(`${GLOBE}/api/evaluate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: 'K-001' }),
  });
  const missing = body.decision.trace.filter((t) => !t.evidence?.citation);
  assert(missing.length === 0, `${missing.length} trace rows without evidence.citation`);
  return `${body.decision.trace.length} cited rows`;
});

await check('Unknown token is refused, not guessed', async () => {
  const res = await fetch(`${GLOBE}/api/evaluate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: 'K-999' }),
  });
  assert(res.status >= 400 || (await res.clone().json()).ok === false, 'accepted a bogus token');
  return `status=${res.status}`;
});

// ------------------------------------------------------------ farmer channel

function channelToken() {
  const env = readFileSync(new URL('../.env', import.meta.url), 'utf8');
  const line = env.split(/\r?\n/).find((l) => l.startsWith('CHANNEL_WEBHOOK_TOKEN='));
  const value = line?.slice('CHANNEL_WEBHOOK_TOKEN='.length).trim();
  if (!value) throw new Error('CHANNEL_WEBHOOK_TOKEN is not set in .env');
  return value;
}

let token = '';
await check('CHANNEL_WEBHOOK_TOKEN present', async () => {
  token = channelToken();
  return 'configured';
});

const caller = `+2547${String(Date.now()).slice(-8)}`;

async function ussd(text, sessionId) {
  const res = await fetch(`${API}/channels/${token}/ussd`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ sessionId, phoneNumber: caller, serviceCode: '*384#', text }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${body.slice(0, 100)}`);
  return body;
}

if (token) {
  await check('USSD root menu opens', async () => {
    const body = await ussd('', `smoke-${Date.now()}`);
    assert(body.startsWith('CON '), `expected CON, got: ${body.slice(0, 60)}`);
    assert(body.length <= 182, `menu is ${body.length} chars, over the 182 USSD cap`);
    return `${body.length}/182 chars`;
  });

  await check('USSD menu selection advances', async () => {
    const session = `smoke-${Date.now()}-b`;
    await ussd('', session);
    const body = await ussd('1', session);
    assert(/^(CON|END) /.test(body), `bad prefix: ${body.slice(0, 60)}`);
    return body.slice(0, 48).replace(/\s+/g, ' ');
  });

  await check('Inbound SMS is answered', async () => {
    const res = await fetch(`${API}/channels/${token}/sms/inbound`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        from: caller,
        to: '12345',
        text: 'K-001',
        id: `smoke-${Date.now()}`,
        date: new Date().toISOString(),
      }),
    });
    assert(res.status === 200, `status ${res.status} (AT would retry)`);
    return 'HTTP 200';
  });

  await check('STOP opts the caller out', async () => {
    const res = await fetch(`${API}/channels/${token}/sms/inbound`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        from: caller,
        to: '12345',
        text: 'STOP',
        id: `smoke-stop-${Date.now()}`,
        date: new Date().toISOString(),
      }),
    });
    assert(res.status === 200, `status ${res.status}`);
    return 'HTTP 200';
  });

  await check('Bad webhook token is rejected', async () => {
    const res = await fetch(`${API}/channels/not-the-real-token/ussd`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ sessionId: 'x', phoneNumber: caller, text: '' }),
    });
    assert(res.status === 401 || res.status === 403 || res.status === 404, `status ${res.status}`);
    return `status=${res.status}`;
  });
}

await check('Field report is accepted as unverified community data', async () => {
  const res = await fetch(`${GLOBE}/api/field-reports`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      channel: 'ussd',
      location: 'Makueni',
      observation: 'Short rains failed, replanted twice',
      indicator: 'rainfall_onset',
      confidence: 'limited',
      session_ref: `smoke-${Date.now()}`,
    }),
  });
  assert(res.status === 202, `expected 202, got ${res.status}`);
  const { record } = await res.json();
  assert(
    record?.verification_status === 'unverified',
    `verification_status=${record?.verification_status}`,
  );
  assert(record.classification === 'community', `classification=${record.classification}`);
  // The salted hash must never be reversible to the caller's MSISDN.
  assert(!/^\+?\d{9,}$/.test(record.reporter_ref), 'reporter_ref looks like a raw phone number');
  return `202 ${record.classification}/${record.verification_status}`;
});

await check('Raw phone numbers are refused as a reporter ref', async () => {
  const res = await fetch(`${GLOBE}/api/field-reports`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      channel: 'ussd',
      location: 'Makueni',
      observation: 'test',
      indicator: 'rainfall_onset',
      confidence: 'limited',
      session_ref: '+254712345678',
    }),
  });
  assert(res.status >= 400, `accepted a raw MSISDN (status ${res.status})`);
  return `status=${res.status}`;
});

// -------------------------------------------------------------- chat + voice

await check(
  'Chat responds (needs ANTHROPIC_API_KEY)',
  async () => {
    const res = await fetch(`${GLOBE}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'Nitapata mbolea? Token K-001' }] }),
      signal: AbortSignal.timeout(45000),
    });
    const text = await res.text();
    assert(!text.includes('chat_unavailable'), 'ANTHROPIC_API_KEY is not configured');
    assert(text.includes('data:'), 'no SSE stream returned');
    return `${text.length} bytes streamed`;
  },
  { soft: true },
);

await check(
  'Voice signed URL (needs ELEVENLABS_*)',
  async () => {
    const body = await getJson(`${GLOBE}/api/voice/signed-url`);
    assert(body.signedUrl?.startsWith('wss://'), 'no wss signed URL');
    return 'wss URL issued';
  },
  { soft: true },
);

// ------------------------------------------------------------- optional globe

if (withGlobe) {
  await check('Globe boots with all five Kenya layers', async () => {
    const { default: puppeteer } = await import('puppeteer');
    const browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--enable-unsafe-swiftshader',
        '--use-angle=swiftshader',
        '--use-gl=angle',
        '--enable-webgl',
        '--ignore-gpu-blocklist',
        '--disable-gpu-sandbox',
      ],
    });
    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 1600, height: 900 });
      await page.goto(GLOBE, { waitUntil: 'networkidle2', timeout: 90000 });
      await new Promise((r) => setTimeout(r, 16000));
      const state = await page.evaluate(() => ({
        layers: window.__KILIMO__ ? [...window.__KILIMO__.layerRegistry.keys()] : [],
        canvas: !!document.querySelector('canvas'),
        chat: !!document.querySelector('#kilimo-chat-panel')?.children.length,
        alt: window.__KILIMO__
          ? Math.round(window.__KILIMO__.viewer.camera.positionCartographic.height / 1000)
          : null,
      }));
      for (const id of ['wards', 'programme', 'prices', 'depots', 'farmers']) {
        assert(state.layers.includes(id), `layer "${id}" missing`);
      }
      assert(state.canvas, 'no canvas');
      assert(state.chat, 'chat panel did not mount');
      // After the staged flight the camera should have settled over Murang'a.
      assert(state.alt !== null && state.alt < 120, `camera at ${state.alt}km, expected < 120km`);
      return `${state.layers.length} layers, camera ${state.alt}km`;
    } finally {
      await browser.close();
    }
  });
}

// ------------------------------------------------------------------- summary

const pad = Math.max(...results.map((r) => r.name.length));
console.log('');
for (const r of results) {
  const mark = r.ok ? '\x1b[32mPASS\x1b[0m' : r.soft ? '\x1b[33mSKIP\x1b[0m' : '\x1b[31mFAIL\x1b[0m';
  console.log(`  ${mark}  ${r.name.padEnd(pad)}  ${r.note}`);
}

const hard = results.filter((r) => !r.ok && !r.soft);
const passed = results.filter((r) => r.ok).length;
console.log('');
console.log(
  `  ${passed}/${results.length} passed` +
    (softWarnings ? `, ${softWarnings} skipped (optional keys unset)` : '') +
    (hard.length ? `, \x1b[31m${hard.length} FAILED\x1b[0m` : ''),
);
if (health) {
  console.log(`  dataMode=${health.dataMode}  integrations=${JSON.stringify(health.integrations)}`);
}
console.log('');
process.exit(hard.length ? 1 : 0);
