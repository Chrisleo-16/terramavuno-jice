/**
 * Supabase implementation of `ChannelStore`.
 *
 * Uses the service role, which bypasses RLS. That is required, not a shortcut: a USSD caller has
 * no `auth.users` row, so channel-owned `conversations` evaluate `auth.uid() = owner_id` to NULL
 * and are invisible to every non-service role by design. The service key must never reach the
 * browser.
 *
 * Privacy invariant: nothing written here contains a phone number. Callers are identified only by
 * `reporter_ref`, the salted hash produced in field-reports.ts.
 *
 * Written against the tables added in 20260902160000_farmer_channel_persistence.sql.
 */
import {createClient, type SupabaseClient} from '@supabase/supabase-js';
import {createHash} from 'node:crypto';
import type {FarmerChannel} from '@terramavuno/shared';
import {matchCounty} from '@terramavuno/shared';
import type {ChannelStore, ConversationRef} from './channel-store.js';
import {FIELD_REPORT_SOURCE_ID, type FieldReportRecord} from './field-reports.js';

export interface EvidenceRow {
  source_id: string;
  area_id: number | null;
  claim: string;
  value: Record<string, unknown> | null;
  valid_from: string;
  confidence: FieldReportRecord['confidence'];
  verification_status: 'unverified';
  channel: FarmerChannel;
  conversation_id: string;
  locator: string;
  source_record_id: string | null;
}

/** Pure mapping from an accepted report to an `evidence_records` row. Unit-tested without a client. */
export function toEvidenceRow(conversationId: string, record: FieldReportRecord, areaId: number | null): EvidenceRow {
  const detail: Record<string, unknown> = {};
  if (record.indicator !== undefined) detail.indicator = record.indicator;
  if (record.value !== undefined) detail.value = record.value;
  if (record.unit !== undefined) detail.unit = record.unit;
  if (record.county === null) detail.unresolved_location = record.location;
  return {
    source_id: record.source_id,
    area_id: areaId,
    claim: record.observation,
    value: Object.keys(detail).length > 0 ? detail : null,
    valid_from: record.observed_at,
    confidence: record.confidence,
    verification_status: 'unverified',
    channel: record.channel,
    conversation_id: conversationId,
    locator: `${record.channel}:conversation:${conversationId}`,
    source_record_id: record.source_record_id ?? null
  };
}

export interface ProvenanceRow {
  entity_table: 'evidence_records';
  entity_id: string;
  action: 'ingest';
  source_id: string;
  input_hash: string;
  output_hash: string;
  transformation: string;
  metadata: Record<string, unknown>;
}

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

/**
 * Pure mapping to a `provenance_events` row. The conversation link lives here rather than in the
 * publicly readable columns of `evidence_records`, so a verified claim cannot be grouped back to
 * its reporter by an anonymous reader.
 */
export function toProvenanceRow(evidenceId: string, conversationId: string, record: FieldReportRecord, row: EvidenceRow): ProvenanceRow {
  return {
    entity_table: 'evidence_records',
    entity_id: evidenceId,
    action: 'ingest',
    source_id: record.source_id,
    // Hashes of the normalised report and the stored row, not of anything identifying.
    input_hash: sha256(JSON.stringify({
      channel: record.channel, location: record.location, observation: record.observation,
      indicator: record.indicator ?? null, value: record.value ?? null, unit: record.unit ?? null,
      observed_at: record.observed_at, reporter_ref: record.reporter_ref
    })),
    output_hash: sha256(JSON.stringify(row)),
    transformation: `Field report received over ${record.channel} and normalised: free-text location "${record.location}" resolved to ${record.county ?? 'no county'}; reporter identity replaced by a salted hash; classified community with verification_status unverified.`,
    metadata: {
      conversation_id: conversationId,
      channel: record.channel,
      reporter_ref: record.reporter_ref,
      county: record.county,
      ingested_at: record.ingested_at,
      source_record_id: record.source_record_id ?? null
    }
  };
}

export function loadSupabaseConfig(env: NodeJS.ProcessEnv = process.env): {url: string; secretKey: string} | null {
  const url = (env.SUPABASE_URL ?? env.VITE_SUPABASE_URL)?.trim();
  const secretKey = env.SUPABASE_SECRET_KEY?.trim();
  if (!url || !secretKey) return null;
  return {url, secretKey};
}

export function createServiceClient(config: {url: string; secretKey: string}): SupabaseClient {
  return createClient(config.url, config.secretKey, {auth: {persistSession: false, autoRefreshToken: false}});
}

function fail(operation: string, error: {message: string} | null): void {
  if (error) throw new Error(`[supabase-channel-store] ${operation} failed: ${error.message}`);
}

export class SupabaseChannelStore implements ChannelStore {
  private areaIds = new Map<string, number | null>();

  constructor(private client: SupabaseClient) {}

  async openConversation(channel: FarmerChannel, identityHash: string, externalThreadId?: string): Promise<ConversationRef> {
    // Upsert rather than select-then-insert: two callbacks from one USSD session arrive
    // concurrently and would otherwise race into duplicate conversation rows.
    const {data, error} = await this.client
      .from('conversations')
      .upsert(
        {channel, channel_identity_hash: identityHash, external_thread_id: externalThreadId ?? null, updated_at: new Date().toISOString()},
        {onConflict: 'channel,channel_identity_hash'}
      )
      .select('id')
      .single();
    fail('openConversation', error);
    if (!data) throw new Error('[supabase-channel-store] openConversation returned no row');
    return {id: (data as {id: string}).id};
  }

  async touchSession(conversationId: string, channelSessionId: string): Promise<void> {
    const {error} = await this.client
      .from('sessions')
      .upsert({conversation_id: conversationId, channel_session_id: channelSessionId}, {onConflict: 'conversation_id,channel_session_id'});
    fail('touchSession', error);
  }

  /** Resolve a county name to `administrative_areas.id`. Cached: 47 static rows. */
  private async resolveAreaId(county: string | null): Promise<number | null> {
    if (!county) return null;
    const slug = matchCounty(county)?.slug;
    if (!slug) return null;
    if (this.areaIds.has(slug)) return this.areaIds.get(slug) ?? null;
    const {data, error} = await this.client
      .from('administrative_areas')
      .select('id')
      .eq('level', 'county')
      .eq('slug', slug)
      .maybeSingle();
    fail('resolveAreaId', error);
    const id = (data as {id: number} | null)?.id ?? null;
    this.areaIds.set(slug, id);
    return id;
  }

  async saveFieldReport(conversationId: string, record: FieldReportRecord): Promise<{persisted: boolean; duplicate?: boolean}> {
    const areaId = await this.resolveAreaId(record.county);
    const row = toEvidenceRow(conversationId, record, areaId);

    if (row.source_record_id) {
      // ignoreDuplicates turns an Africa's Talking retry into a no-op instead of a second report.
      const {data, error} = await this.client
        .from('evidence_records')
        .upsert(row, {onConflict: 'source_id,source_record_id', ignoreDuplicates: true})
        .select('id');
      fail('saveFieldReport', error);
      const inserted = (data as {id: string}[] | null) ?? [];
      if (inserted.length === 0) return {persisted: true, duplicate: true};
      await this.writeProvenance(inserted[0].id, conversationId, record, row);
      return {persisted: true};
    }

    const {data, error} = await this.client.from('evidence_records').insert(row).select('id').single();
    fail('saveFieldReport', error);
    if (!data) throw new Error('[supabase-channel-store] saveFieldReport returned no row');
    await this.writeProvenance((data as {id: string}).id, conversationId, record, row);
    return {persisted: true};
  }

  private async writeProvenance(evidenceId: string, conversationId: string, record: FieldReportRecord, row: EvidenceRow): Promise<void> {
    const {error} = await this.client.from('provenance_events').insert(toProvenanceRow(evidenceId, conversationId, record, row));
    fail('writeProvenance', error);
  }

  async isOptedOut(identityHash: string): Promise<boolean> {
    const {data, error} = await this.client
      .from('channel_preferences')
      .select('opted_out')
      .eq('identity_hash', identityHash)
      .maybeSingle();
    fail('isOptedOut', error);
    return (data as {opted_out: boolean} | null)?.opted_out ?? false;
  }

  async setOptedOut(identityHash: string, optedOut: boolean): Promise<void> {
    const now = new Date().toISOString();
    const {error} = await this.client
      .from('channel_preferences')
      .upsert({identity_hash: identityHash, opted_out: optedOut, opted_out_at: optedOut ? now : null, updated_at: now}, {onConflict: 'identity_hash'});
    fail('setOptedOut', error);
  }
}

/** Returns null when Supabase is not configured, so the caller can fall back to the in-memory store. */
export function createSupabaseChannelStore(env: NodeJS.ProcessEnv = process.env): SupabaseChannelStore | null {
  const config = loadSupabaseConfig(env);
  return config ? new SupabaseChannelStore(createServiceClient(config)) : null;
}
