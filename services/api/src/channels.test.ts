import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import request from 'supertest';
import {createApp} from './app.js';
import {InMemoryChannelStore} from './channel-store.js';
import {toE164} from './africastalking.js';
import {hashIdentity} from './field-reports.js';

const TOKEN = 'test-webhook-token';
const CALLER = '+254712345678';

let store: InMemoryChannelStore;
let sent: {to: string[]; message: string}[];
let app: ReturnType<typeof createApp>;

/** Webhook handlers reply before performing effects; let the microtask/timer queue drain. */
const flush = () => new Promise(resolve => setTimeout(resolve, 10));

beforeEach(() => {
  process.env.CHANNEL_WEBHOOK_TOKEN = TOKEN;
  store = new InMemoryChannelStore();
  sent = [];
  app = createApp({store, config: null, send: async (to, message) => { sent.push({to, message}); }});
});
afterEach(() => { delete process.env.CHANNEL_WEBHOOK_TOKEN; });

const ussd = (text: string, sessionId = 'AT-session-1') =>
  request(app).post(`/channels/${TOKEN}/ussd`).type('form').send({sessionId, serviceCode: '*384*1234#', phoneNumber: CALLER, text});
const inboundSms = (text: string) =>
  request(app).post(`/channels/${TOKEN}/sms/inbound`).type('form').send({from: CALLER, to: '12345', text, id: 'msg-1', linkId: 'link-1', date: '2026-09-02 12:00:00'});

describe('webhook authentication', () => {
  it('404s an unknown token without revealing whether the route exists', async () => {
    expect((await request(app).post('/channels/wrong-token/ussd').type('form').send({text: ''})).status).toBe(404);
  });

  it('503s when no token is configured, rather than accepting unauthenticated traffic', async () => {
    delete process.env.CHANNEL_WEBHOOK_TOKEN;
    const res = await request(app).post(`/channels/${TOKEN}/ussd`).type('form').send({text: ''});
    expect(res.status).toBe(503);
    expect(res.text).toContain('CHANNEL_WEBHOOK_TOKEN');
  });
});

describe('ussd webhook', () => {
  it('answers the AT contract: text/plain starting with CON', async () => {
    const res = await ussd('');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/plain/);
    expect(res.text.startsWith('CON ')).toBe(true);
    expect(res.text).toContain('Report from my farm');
  });

  it('ends the session with an outlook', async () => {
    const res = await ussd('1*makueni');
    expect(res.text.startsWith('END ')).toBe(true);
    expect(res.text).toContain('Makueni');
  });

  it('stores a field report keyed to a hashed identity, never the phone number', async () => {
    await ussd('2*1*makueni');
    await flush();
    const snapshot = store.snapshot();
    expect(snapshot).toHaveLength(1);
    expect(snapshot[0].channel).toBe('ussd');
    expect(snapshot[0].identityHash).toBe(hashIdentity(CALLER));
    expect(snapshot[0].reports).toBe(1);
    expect(JSON.stringify(snapshot)).not.toContain('712345678');
  });

  it('records the provider session id against the conversation', async () => {
    await ussd('', 'AT-session-xyz');
    await flush();
    expect(store.snapshot()[0].sessions).toContain('AT-session-xyz');
  });

  it('sends the advisory by SMS when the caller picks option 3', async () => {
    await ussd('3*turkana');
    await flush();
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toEqual([CALLER]);
    expect(sent[0].message).toContain('Turkana');
    expect(sent[0].message).toContain('DEMO, not official');
  });

  it('does not send or store anything for a mid-session screen', async () => {
    await ussd('2');
    await flush();
    expect(sent).toHaveLength(0);
    expect(store.snapshot()[0].reports).toBe(0);
  });
});

describe('inbound sms webhook', () => {
  it('replies to a bare county name with the advisory', async () => {
    expect((await inboundSms('Makueni')).status).toBe(200);
    await flush();
    expect(sent[0].message).toContain('Makueni');
  });

  it('accepts a REPORT and acknowledges it as unverified', async () => {
    await inboundSms('REPORT Kitui short rains failed');
    await flush();
    expect(store.snapshot()[0].reports).toBe(1);
    expect(sent[0].message).toContain('unverified community evidence');
  });

  it('keeps a two-word county out of the observation text', async () => {
    await inboundSms('REPORT Homa Bay water point down');
    await flush();
    expect(sent[0].message).toContain('Homa Bay');
  });

  it('sends help when the county cannot be resolved', async () => {
    await inboundSms('qqqq');
    await flush();
    expect(sent[0].message).toContain('send a county name');
  });

  it('honours STOP and then stays silent', async () => {
    await inboundSms('STOP');
    await flush();
    expect(sent).toHaveLength(1);
    expect(sent[0].message).toContain('will not receive further advisories');
    await inboundSms('Makueni');
    await flush();
    expect(sent).toHaveLength(1);
  });

  it('resumes on START', async () => {
    await inboundSms('STOP');
    await inboundSms('START');
    await flush();
    expect(sent.at(-1)?.message).toContain('advisories resumed');
    await inboundSms('Makueni');
    await flush();
    expect(sent.at(-1)?.message).toContain('Makueni');
  });

  it('suppresses a USSD-triggered advisory for an opted-out caller', async () => {
    await inboundSms('STOP');
    await flush();
    sent = [];
    await ussd('3*makueni');
    await flush();
    expect(sent).toHaveLength(0);
  });

  it('always returns 200 so Africa\'s Talking does not retry', async () => {
    expect((await inboundSms('')).status).toBe(200);
    expect((await request(app).post(`/channels/${TOKEN}/sms/inbound`).type('form').send({})).status).toBe(200);
  });
});

describe('provider retry idempotency', () => {
  const retriableSms = (id: string) =>
    request(app).post(`/channels/${TOKEN}/sms/inbound`).type('form')
      .send({from: CALLER, to: '12345', text: 'REPORT Makueni short rains failed', id});

  it('does not file a second report or bill a second ack when AT re-posts the same message', async () => {
    await retriableSms('at-msg-1');
    await flush();
    expect(store.snapshot()[0].reports).toBe(1);
    expect(sent).toHaveLength(1);

    await retriableSms('at-msg-1'); // the retry
    await flush();
    expect(store.snapshot()[0].reports).toBe(1);
    expect(sent).toHaveLength(1);
  });

  it('still accepts a genuinely new message from the same caller', async () => {
    await retriableSms('at-msg-1');
    await retriableSms('at-msg-2');
    await flush();
    expect(store.snapshot()[0].reports).toBe(2);
  });

  it('deduplicates a replayed USSD callback for the same session and input path', async () => {
    await ussd('2*1*makueni', 'AT-session-dup');
    await flush();
    await ussd('2*1*makueni', 'AT-session-dup');
    await flush();
    expect(store.snapshot()[0].reports).toBe(1);
  });

  it('treats a different session as a different report', async () => {
    await ussd('2*1*makueni', 'AT-session-a');
    await ussd('2*1*makueni', 'AT-session-b');
    await flush();
    expect(store.snapshot()[0].reports).toBe(2);
  });
});

describe('delivery reports', () => {
  it('acknowledges a delivery callback', async () => {
    const res = await request(app).post(`/channels/${TOKEN}/sms/delivery`).type('form')
      .send({id: 'msg-1', status: 'Failed', failureReason: 'UserInBlackList', phoneNumber: CALLER});
    expect(res.status).toBe(200);
  });
});

describe('msisdn normalisation', () => {
  it('accepts the formats Kenyan users actually type', () => {
    expect(toE164('0712345678')).toBe('+254712345678');
    expect(toE164('712345678')).toBe('+254712345678');
    expect(toE164('254712345678')).toBe('+254712345678');
    expect(toE164('+254 712 345 678')).toBe('+254712345678');
  });

  it('rejects rather than guessing on garbage', () => {
    expect(toE164('12')).toBeNull();
    expect(toE164('not-a-number')).toBeNull();
  });
});

describe('health', () => {
  it('reports channel wiring status without leaking the key', async () => {
    const res = await request(app).get('/health');
    expect(res.body.channels.webhooksEnabled).toBe(true);
    expect(res.body.channels).toHaveProperty('identitySalt');
    expect(JSON.stringify(res.body)).not.toContain(TOKEN);
  });
});
