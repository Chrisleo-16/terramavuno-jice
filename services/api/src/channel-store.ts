/**
 * Persistence boundary for the farmer channel.
 *
 * The in-memory implementation is the P0 default so the channel is exercisable without a database.
 * A Supabase implementation drops in behind the same interface and writes `conversations`,
 * `sessions`, `evidence_records` and a `provenance_events` row linking the two — see
 * modules/omnichannel/README.md. Nothing here stores a raw phone number: callers are identified by
 * the salted hash only.
 */
import type {FarmerChannel} from '@terramavuno/shared';
import type {FieldReportRecord} from './field-reports.js';

export interface ConversationRef { id: string }

export interface SaveResult {
  /** `false` means the contract ran but nothing durable was written (in-memory store). */
  persisted: boolean;
  /** `true` when a provider retry was recognised by `source_record_id` and ignored. */
  duplicate?: boolean;
}

export interface ChannelStore {
  /** Find or create the conversation for a hashed channel identity. */
  openConversation(channel: FarmerChannel, identityHash: string, externalThreadId?: string): Promise<ConversationRef>;
  /** Record a provider session against a conversation (USSD sessionId, SMS linkId). */
  touchSession(conversationId: string, channelSessionId: string): Promise<void>;
  saveFieldReport(conversationId: string, record: FieldReportRecord): Promise<SaveResult>;
  isOptedOut(identityHash: string): Promise<boolean>;
  setOptedOut(identityHash: string, optedOut: boolean): Promise<void>;
}

interface MemoryConversation { id: string; channel: FarmerChannel; identityHash: string; sessions: Set<string>; reports: FieldReportRecord[] }

/** Process-local store. Everything is lost on restart, which is correct for a demo and wrong for production. */
export class InMemoryChannelStore implements ChannelStore {
  private conversations = new Map<string, MemoryConversation>();
  private optedOut = new Set<string>();
  private seenRecordIds = new Set<string>();
  private counter = 0;

  private key(channel: FarmerChannel, identityHash: string) { return `${channel}:${identityHash}`; }

  async openConversation(channel: FarmerChannel, identityHash: string): Promise<ConversationRef> {
    const key = this.key(channel, identityHash);
    const existing = this.conversations.get(key);
    if (existing) return {id: existing.id};
    const id = `mem-${++this.counter}`;
    this.conversations.set(key, {id, channel, identityHash, sessions: new Set(), reports: []});
    return {id};
  }

  async touchSession(conversationId: string, channelSessionId: string): Promise<void> {
    for (const c of this.conversations.values()) if (c.id === conversationId) c.sessions.add(channelSessionId);
  }

  async saveFieldReport(conversationId: string, record: FieldReportRecord): Promise<SaveResult> {
    // Mirror the Supabase idempotency behaviour so a provider retry behaves the same either way.
    if (record.source_record_id && this.seenRecordIds.has(record.source_record_id)) {
      return {persisted: false, duplicate: true};
    }
    if (record.source_record_id) this.seenRecordIds.add(record.source_record_id);
    for (const c of this.conversations.values()) if (c.id === conversationId) c.reports.push(record);
    return {persisted: false};
  }

  async isOptedOut(identityHash: string): Promise<boolean> { return this.optedOut.has(identityHash); }
  async setOptedOut(identityHash: string, optedOut: boolean): Promise<void> {
    optedOut ? this.optedOut.add(identityHash) : this.optedOut.delete(identityHash);
  }

  /** Test/inspection helper; not part of the interface. */
  snapshot() {
    return [...this.conversations.values()].map(c => ({
      id: c.id, channel: c.channel, identityHash: c.identityHash,
      sessions: [...c.sessions], reports: c.reports.length
    }));
  }
}
