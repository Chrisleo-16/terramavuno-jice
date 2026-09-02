import {beforeEach, describe, expect, it} from 'vitest';
import type {SupabaseClient} from '@supabase/supabase-js';
import {SupabaseChannelStore, loadSupabaseConfig, toEvidenceRow, toProvenanceRow} from './supabase-channel-store.js';
import {buildFieldReport, hashIdentity, type FieldReportRecord} from './field-reports.js';

const CALLER = '+254712345678';
const record = (over: Partial<Parameters<typeof buildFieldReport>[0]> = {}): FieldReportRecord =>
  buildFieldReport({
    channel: 'ussd', location: 'Makueni', observation: 'Rains failed or late',
    indicator: 'rainfall_onset', confidence: 'limited', reporter_ref: hashIdentity(CALLER), ...over
  } as Parameters<typeof buildFieldReport>[0]);

// ---------------------------------------------------------------------------------------------
// Fake client: records every call so the tests can assert on tables, conflict targets and
// payloads. Mirrors only the chains the store actually uses.
// ---------------------------------------------------------------------------------------------
interface Call {table: string; op: string; payload?: unknown; options?: unknown; filters: [string, unknown][]}

function fakeClient(responses: Record<string, {data: unknown; error: {message: string} | null}> = {}) {
  const calls: Call[] = [];
  const client = {
    from(table: string) {
      const call: Call = {table, op: '', filters: []};
      const key = (op: string) => `${table}.${op}`;
      const builder = {
        upsert(payload: unknown, options?: unknown) { call.op = 'upsert'; call.payload = payload; call.options = options; calls.push(call); return builder; },
        insert(payload: unknown) { call.op = 'insert'; call.payload = payload; calls.push(call); return builder; },
        select(_cols: string) { if (!call.op) { call.op = 'select'; calls.push(call); } return builder; },
        eq(col: string, val: unknown) { call.filters.push([col, val]); return builder; },
        single() { return Promise.resolve(responses[key(call.op)] ?? responses[key('select')] ?? {data: null, error: null}); },
        maybeSingle() { return Promise.resolve(responses[key(call.op)] ?? responses[key('select')] ?? {data: null, error: null}); },
        then(resolve: (v: unknown) => unknown) { return Promise.resolve(responses[key(call.op)] ?? {data: null, error: null}).then(resolve); }
      };
      return builder;
    }
  };
  return {client: client as unknown as SupabaseClient, calls};
}

const AREA = {data: {id: 17}, error: null};

describe('evidence row mapping', () => {
  it('maps a report onto evidence_records as unverified community evidence', () => {
    const row = toEvidenceRow('conv-1', record(), 17);
    expect(row).toMatchObject({
      area_id: 17, claim: 'Rains failed or late', confidence: 'limited',
      verification_status: 'unverified', channel: 'ussd', conversation_id: 'conv-1',
      locator: 'ussd:conversation:conv-1'
    });
    expect(row.value).toEqual({indicator: 'rainfall_onset'});
  });

  it('keeps an unresolved free-text location instead of discarding it', () => {
    const row = toEvidenceRow('conv-1', record({location: 'somewhere near the river'}), null);
    expect(row.area_id).toBeNull();
    expect(row.value).toMatchObject({unresolved_location: 'somewhere near the river'});
  });

  it('never puts a phone number in the row', () => {
    const row = toEvidenceRow('conv-1', record(), 17);
    expect(JSON.stringify(row)).not.toContain('712345678');
    expect(JSON.stringify(row)).not.toContain('254');
  });

  it('records the transformation and hashes in provenance, and the conversation link only there', () => {
    const r = record();
    const row = toEvidenceRow('conv-1', r, 17);
    const prov = toProvenanceRow('ev-1', 'conv-1', r, row);
    expect(prov).toMatchObject({entity_table: 'evidence_records', entity_id: 'ev-1', action: 'ingest'});
    expect(prov.transformation).toContain('salted hash');
    expect(prov.transformation).toContain('Makueni');
    expect(prov.input_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(prov.output_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(prov.metadata.conversation_id).toBe('conv-1');
    expect(JSON.stringify(prov)).not.toContain('712345678');
  });

  it('produces a stable output hash for an identical row', () => {
    const r = record();
    const row = toEvidenceRow('conv-1', r, 17);
    expect(toProvenanceRow('ev-1', 'conv-1', r, row).output_hash).toBe(toProvenanceRow('ev-2', 'conv-1', r, row).output_hash);
  });
});

describe('supabase channel store', () => {
  let fake: ReturnType<typeof fakeClient>;
  let store: SupabaseChannelStore;

  beforeEach(() => {
    fake = fakeClient({
      'conversations.upsert': {data: {id: 'conv-1'}, error: null},
      'administrative_areas.select': AREA,
      'evidence_records.insert': {data: {id: 'ev-1'}, error: null},
      'evidence_records.upsert': {data: [{id: 'ev-1'}], error: null},
      'provenance_events.insert': {data: null, error: null},
      'sessions.upsert': {data: null, error: null},
      'channel_preferences.upsert': {data: null, error: null}
    });
    store = new SupabaseChannelStore(fake.client);
  });

  it('upserts the conversation on the channel + identity hash conflict target', async () => {
    const hash = hashIdentity(CALLER);
    expect(await store.openConversation('ussd', hash, 'AT-1')).toEqual({id: 'conv-1'});
    const call = fake.calls.find(c => c.table === 'conversations');
    expect(call?.op).toBe('upsert');
    expect(call?.options).toMatchObject({onConflict: 'channel,channel_identity_hash'});
    expect(call?.payload).toMatchObject({channel: 'ussd', channel_identity_hash: hash});
    // owner_id is left unset: a USSD caller has no auth.users row.
    expect(call?.payload).not.toHaveProperty('owner_id');
    expect(JSON.stringify(call?.payload)).not.toContain('712345678');
  });

  it('writes the evidence row and a provenance event', async () => {
    const result = await store.saveFieldReport('conv-1', record());
    expect(result).toEqual({persisted: true});
    expect(fake.calls.map(c => `${c.table}.${c.op}`)).toEqual([
      'administrative_areas.select', 'evidence_records.insert', 'provenance_events.insert'
    ]);
  });

  it('resolves the county to an area id and caches the lookup', async () => {
    await store.saveFieldReport('conv-1', record());
    await store.saveFieldReport('conv-1', record());
    const lookups = fake.calls.filter(c => c.table === 'administrative_areas');
    expect(lookups).toHaveLength(1);
    expect(lookups[0].filters).toEqual([['level', 'county'], ['slug', 'makueni']]);
  });

  it('treats a provider retry as a no-op instead of a second report', async () => {
    fake = fakeClient({
      'administrative_areas.select': AREA,
      'evidence_records.upsert': {data: [], error: null}, // conflict: nothing inserted
      'provenance_events.insert': {data: null, error: null}
    });
    store = new SupabaseChannelStore(fake.client);
    const result = await store.saveFieldReport('conv-1', record({source_record_id: 'sms:at-msg-1'}));
    expect(result).toEqual({persisted: true, duplicate: true});
    // No provenance event for a report that was not written.
    expect(fake.calls.some(c => c.table === 'provenance_events')).toBe(false);
  });

  it('uses the idempotency conflict target when a provider record id is present', async () => {
    await store.saveFieldReport('conv-1', record({source_record_id: 'sms:at-msg-1'}));
    const call = fake.calls.find(c => c.table === 'evidence_records');
    expect(call?.op).toBe('upsert');
    expect(call?.options).toMatchObject({onConflict: 'source_id,source_record_id', ignoreDuplicates: true});
  });

  it('stores opt-out against the identity hash so it applies across channels', async () => {
    const hash = hashIdentity(CALLER);
    await store.setOptedOut(hash, true);
    const call = fake.calls.find(c => c.table === 'channel_preferences');
    expect(call?.options).toMatchObject({onConflict: 'identity_hash'});
    expect(call?.payload).toMatchObject({identity_hash: hash, opted_out: true});
    expect((call?.payload as {opted_out_at: string}).opted_out_at).toBeTruthy();
  });

  it('defaults to opted-in when no preference row exists', async () => {
    expect(await store.isOptedOut(hashIdentity(CALLER))).toBe(false);
  });

  it('surfaces a database error rather than reporting a silent success', async () => {
    fake = fakeClient({'conversations.upsert': {data: null, error: {message: 'permission denied for table conversations'}}});
    store = new SupabaseChannelStore(fake.client);
    await expect(store.openConversation('sms', hashIdentity(CALLER))).rejects.toThrow(/permission denied/);
  });
});

describe('config loading', () => {
  it('prefers the server URL and falls back to the browser one', () => {
    expect(loadSupabaseConfig({SUPABASE_URL: 'https://a', VITE_SUPABASE_URL: 'https://b', SUPABASE_SECRET_KEY: 'k'})).toEqual({url: 'https://a', secretKey: 'k'});
    expect(loadSupabaseConfig({VITE_SUPABASE_URL: 'https://b', SUPABASE_SECRET_KEY: 'k'})).toEqual({url: 'https://b', secretKey: 'k'});
  });

  it('returns null without a secret key so the caller falls back to in-memory', () => {
    expect(loadSupabaseConfig({SUPABASE_URL: 'https://a'})).toBeNull();
    expect(loadSupabaseConfig({})).toBeNull();
  });
});
