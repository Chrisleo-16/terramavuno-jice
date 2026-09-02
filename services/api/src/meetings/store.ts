/**
 * Meeting persistence, with the same honesty contract as the data provider:
 * try Supabase under a hard timeout, fall back to an in-memory store seeded
 * with the demo meetings, and ALWAYS declare which one answered via `dataMode`.
 *
 * The in-memory store is not a stub — it is the keyless demo path, and it is
 * what the tests run against. Writes to it are process-local and disappear on
 * restart, which is correct for a demo and clearly signalled by `dataMode:
 * 'bundled'` on every response.
 *
 * Privacy: an RSVP is keyed by an opaque farmer token (K-001). Phone numbers
 * are accepted transiently to send a notice and are never persisted here.
 */
import type { Meeting, MeetingRsvp, RsvpResponse } from '@terramavuno/shared';
import { getSupabaseClient, SUPABASE_TIMEOUT_MS } from '../data/provider.js';

export type MeetingsDataMode = 'supabase' | 'bundled';

export interface MeetingsPayload<T> {
  data: T;
  dataMode: MeetingsDataMode;
}

/**
 * Demo meetings. Dated relative to process start so the demo is never showing
 * a meeting that has already happened — a stale calendar is exactly the kind of
 * quiet wrongness this project exists to avoid.
 */
export function seedMeetings(now: Date = new Date()): Meeting[] {
  const inDays = (days: number, hourEat: number): string => {
    const d = new Date(now.getTime() + days * 86_400_000);
    // hourEat is East Africa Time; store the UTC instant.
    d.setUTCHours(hourEat - 3, 0, 0, 0);
    return d.toISOString();
  };
  const createdAt = now.toISOString();
  return [
    {
      id: 'mtg-collection-briefing',
      title: 'Fertilizer collection briefing',
      agenda: 'Collection dates, what to bring, and how the queue will be managed.',
      mode: 'physical',
      authority: 'official',
      status: 'scheduled',
      startsAt: inDays(7, 10),
      durationMinutes: 90,
      wardCode: '0539',
      wardName: "Ng'araria",
      location: {
        venue: 'Kandara Ward Agricultural Office',
        lat: -0.8512,
        lon: 36.9498,
      },
      joinUrl: null,
      organiser: 'Kandara Ward Agricultural Office',
      citation: 'SIMULATED meeting record (demo seed) - not an official MoALD notice.',
      createdAt,
    },
    {
      id: 'mtg-registration-clinic',
      title: 'ID linkage and registration clinic',
      agenda:
        'For farmers whose national ID is not yet linked to the register. Bring your ID card.',
      mode: 'hybrid',
      authority: 'official',
      status: 'scheduled',
      startsAt: inDays(1, 9),
      durationMinutes: 120,
      wardCode: '0540',
      wardName: 'Muruka',
      location: { venue: 'Muruka Chief Camp', lat: -0.9261, lon: 37.0555 },
      joinUrl: 'https://meet.google.com/terramavuno-demo',
      organiser: 'Kandara Sub-County Agricultural Office',
      citation: 'SIMULATED meeting record (demo seed) - not an official MoALD notice.',
      createdAt,
    },
    {
      id: 'mtg-county-price-forum',
      title: "Murang'a county price forum",
      agenda: 'Gazetted price review for the 2026 Long Rains, open to all wards.',
      mode: 'online',
      authority: 'official',
      status: 'scheduled',
      startsAt: inDays(14, 14),
      durationMinutes: 60,
      wardCode: null,
      wardName: null,
      location: null,
      joinUrl: 'https://meet.google.com/terramavuno-forum',
      organiser: "Murang'a County Department of Agriculture",
      citation: 'SIMULATED meeting record (demo seed) - not an official MoALD notice.',
      createdAt,
    },
    {
      id: 'mtg-farmer-group',
      title: 'Kandara farmer group meet-up',
      agenda: 'Farmer-organised: sharing depot queue experiences and transport pooling.',
      mode: 'physical',
      authority: 'community',
      status: 'scheduled',
      startsAt: inDays(4, 16),
      durationMinutes: 60,
      wardCode: '0543',
      wardName: 'Ruchu',
      location: { venue: 'Ruchu Social Hall', lat: -0.8315, lon: 36.9213 },
      joinUrl: null,
      organiser: 'Ruchu Farmers Self-Help Group',
      citation:
        'SIMULATED community notice (demo seed) - self-organised, not an official programme meeting.',
      createdAt,
    },
  ];
}

export interface MeetingsStore {
  list(): Promise<MeetingsPayload<Meeting[]>>;
  get(id: string): Promise<MeetingsPayload<Meeting | null>>;
  create(meeting: Meeting): Promise<MeetingsPayload<Meeting>>;
  cancel(id: string): Promise<MeetingsPayload<Meeting | null>>;
  rsvp(rsvp: MeetingRsvp): Promise<MeetingsPayload<MeetingRsvp>>;
  rsvpsFor(meetingId: string): Promise<MeetingsPayload<MeetingRsvp[]>>;
  /** Reminder keys already dispatched, as `${meetingId}:${offsetDays}`. */
  sentReminders(): Promise<Set<string>>;
  markReminderSent(key: string): Promise<void>;
}

/* ------------------------------------------------------------------ */
/* In-memory (bundled) store                                           */
/* ------------------------------------------------------------------ */

export class MemoryMeetingsStore implements MeetingsStore {
  private meetings: Meeting[];
  private rsvps: MeetingRsvp[] = [];
  private reminders = new Set<string>();

  constructor(seed: Meeting[] = seedMeetings()) {
    this.meetings = [...seed];
  }

  list(): Promise<MeetingsPayload<Meeting[]>> {
    return Promise.resolve({ data: [...this.meetings], dataMode: 'bundled' });
  }

  get(id: string): Promise<MeetingsPayload<Meeting | null>> {
    return Promise.resolve({
      data: this.meetings.find((m) => m.id === id) ?? null,
      dataMode: 'bundled',
    });
  }

  create(meeting: Meeting): Promise<MeetingsPayload<Meeting>> {
    this.meetings.push(meeting);
    return Promise.resolve({ data: meeting, dataMode: 'bundled' });
  }

  cancel(id: string): Promise<MeetingsPayload<Meeting | null>> {
    const found = this.meetings.find((m) => m.id === id);
    if (found === undefined) return Promise.resolve({ data: null, dataMode: 'bundled' });
    const cancelled: Meeting = { ...found, status: 'cancelled' };
    this.meetings = this.meetings.map((m) => (m.id === id ? cancelled : m));
    return Promise.resolve({ data: cancelled, dataMode: 'bundled' });
  }

  rsvp(rsvp: MeetingRsvp): Promise<MeetingsPayload<MeetingRsvp>> {
    // Last answer wins — a farmer may change their mind.
    this.rsvps = this.rsvps.filter(
      (r) => !(r.meetingId === rsvp.meetingId && r.farmerToken === rsvp.farmerToken),
    );
    this.rsvps.push(rsvp);
    return Promise.resolve({ data: rsvp, dataMode: 'bundled' });
  }

  rsvpsFor(meetingId: string): Promise<MeetingsPayload<MeetingRsvp[]>> {
    return Promise.resolve({
      data: this.rsvps.filter((r) => r.meetingId === meetingId),
      dataMode: 'bundled',
    });
  }

  sentReminders(): Promise<Set<string>> {
    return Promise.resolve(new Set(this.reminders));
  }

  markReminderSent(key: string): Promise<void> {
    this.reminders.add(key);
    return Promise.resolve();
  }
}

/* ------------------------------------------------------------------ */
/* Supabase store, with fallback                                       */
/* ------------------------------------------------------------------ */

interface MeetingRow {
  id: string;
  title: string;
  agenda: string | null;
  mode: Meeting['mode'];
  authority: Meeting['authority'];
  status: Meeting['status'];
  starts_at: string;
  duration_minutes: number;
  ward_code: string | null;
  ward_name: string | null;
  venue: string | null;
  lat: number | null;
  lon: number | null;
  join_url: string | null;
  organiser: string;
  citation: string;
  created_at: string;
}

/** Row -> domain. Returns null for a row too malformed to show a farmer. */
export function mapMeetingRow(row: MeetingRow): Meeting | null {
  if (typeof row.id !== 'string' || typeof row.title !== 'string') return null;
  if (typeof row.starts_at !== 'string') return null;
  const hasLocation = row.venue !== null && row.venue.length > 0;
  return {
    id: row.id,
    title: row.title,
    agenda: row.agenda ?? '',
    mode: row.mode,
    authority: row.authority,
    status: row.status,
    startsAt: new Date(row.starts_at).toISOString(),
    durationMinutes: row.duration_minutes,
    wardCode: row.ward_code,
    wardName: row.ward_name,
    location: hasLocation ? { venue: row.venue!, lat: row.lat, lon: row.lon } : null,
    joinUrl: row.join_url,
    organiser: row.organiser,
    citation: row.citation,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

/** Domain -> row. */
export function toMeetingRow(meeting: Meeting): MeetingRow {
  return {
    id: meeting.id,
    title: meeting.title,
    agenda: meeting.agenda,
    mode: meeting.mode,
    authority: meeting.authority,
    status: meeting.status,
    starts_at: meeting.startsAt,
    duration_minutes: meeting.durationMinutes,
    ward_code: meeting.wardCode,
    ward_name: meeting.wardName,
    venue: meeting.location?.venue ?? null,
    lat: meeting.location?.lat ?? null,
    lon: meeting.location?.lon ?? null,
    join_url: meeting.joinUrl,
    organiser: meeting.organiser,
    citation: meeting.citation,
    created_at: meeting.createdAt,
  };
}

/**
 * Race a Supabase call against the shared timeout.
 * Resolves null on ANY failure so every caller has one fallback path.
 */
async function attempt<T>(run: () => PromiseLike<{ data: T | null; error: unknown }>): Promise<T | null> {
  try {
    const result = await Promise.race([
      Promise.resolve(run()),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), SUPABASE_TIMEOUT_MS),
      ),
    ]);
    if (result.error !== null && result.error !== undefined) return null;
    return result.data;
  } catch {
    return null;
  }
}

/**
 * Supabase-backed store that degrades to an in-memory one.
 *
 * The fallback is per-call, not per-process: a transient database blip
 * downgrades one response to `bundled` rather than pinning the whole server
 * into demo mode.
 */
export class SupabaseMeetingsStore implements MeetingsStore {
  constructor(private readonly fallback: MemoryMeetingsStore = new MemoryMeetingsStore()) {}

  private client() {
    return getSupabaseClient();
  }

  async list(): Promise<MeetingsPayload<Meeting[]>> {
    const client = this.client();
    if (client === null) return this.fallback.list();
    const rows = await attempt<MeetingRow[]>(() =>
      client.from('meetings').select('*').order('starts_at', { ascending: true }),
    );
    if (rows === null) return this.fallback.list();
    const mapped = rows.map(mapMeetingRow).filter((m): m is Meeting => m !== null);
    // An empty table means the migration ran but nothing was seeded — the demo
    // is more useful with the seed than with a blank calendar.
    if (mapped.length === 0) return this.fallback.list();
    return { data: mapped, dataMode: 'supabase' };
  }

  async get(id: string): Promise<MeetingsPayload<Meeting | null>> {
    const { data, dataMode } = await this.list();
    return { data: data.find((m) => m.id === id) ?? null, dataMode };
  }

  async create(meeting: Meeting): Promise<MeetingsPayload<Meeting>> {
    const client = this.client();
    if (client === null) return this.fallback.create(meeting);
    const rows = await attempt<MeetingRow[]>(() =>
      client.from('meetings').insert(toMeetingRow(meeting)).select(),
    );
    const created = rows?.[0] === undefined ? null : mapMeetingRow(rows[0]);
    if (created === null) return this.fallback.create(meeting);
    return { data: created, dataMode: 'supabase' };
  }

  async cancel(id: string): Promise<MeetingsPayload<Meeting | null>> {
    const client = this.client();
    if (client === null) return this.fallback.cancel(id);
    const rows = await attempt<MeetingRow[]>(() =>
      client.from('meetings').update({ status: 'cancelled' }).eq('id', id).select(),
    );
    const updated = rows?.[0] === undefined ? null : mapMeetingRow(rows[0]);
    if (updated === null) return this.fallback.cancel(id);
    return { data: updated, dataMode: 'supabase' };
  }

  async rsvp(rsvp: MeetingRsvp): Promise<MeetingsPayload<MeetingRsvp>> {
    const client = this.client();
    if (client === null) return this.fallback.rsvp(rsvp);
    const ok = await attempt<unknown>(() =>
      client
        .from('meeting_rsvps')
        .upsert(
          {
            meeting_id: rsvp.meetingId,
            farmer_token: rsvp.farmerToken,
            response: rsvp.response,
            responded_at: rsvp.respondedAt,
          },
          { onConflict: 'meeting_id,farmer_token' },
        )
        .select(),
    );
    if (ok === null) return this.fallback.rsvp(rsvp);
    return { data: rsvp, dataMode: 'supabase' };
  }

  async rsvpsFor(meetingId: string): Promise<MeetingsPayload<MeetingRsvp[]>> {
    const client = this.client();
    if (client === null) return this.fallback.rsvpsFor(meetingId);
    const rows = await attempt<
      { meeting_id: string; farmer_token: string; response: RsvpResponse; responded_at: string }[]
    >(() => client.from('meeting_rsvps').select('*').eq('meeting_id', meetingId));
    if (rows === null) return this.fallback.rsvpsFor(meetingId);
    return {
      data: rows.map((r) => ({
        meetingId: r.meeting_id,
        farmerToken: r.farmer_token,
        response: r.response,
        respondedAt: new Date(r.responded_at).toISOString(),
      })),
      dataMode: 'supabase',
    };
  }

  // Reminder bookkeeping stays process-local: it is a delivery detail, not
  // farmer-facing evidence, and duplicating it across replicas is a cost
  // problem rather than a correctness one.
  sentReminders(): Promise<Set<string>> {
    return this.fallback.sentReminders();
  }

  markReminderSent(key: string): Promise<void> {
    return this.fallback.markReminderSent(key);
  }
}

/** Process-wide store. Supabase when configured, memory otherwise. */
let store: MeetingsStore | null = null;

export function getMeetingsStore(): MeetingsStore {
  store ??= getSupabaseClient() === null ? new MemoryMeetingsStore() : new SupabaseMeetingsStore();
  return store;
}

/** Test seam — resets the singleton so a suite can install its own store. */
export function setMeetingsStore(next: MeetingsStore | null): void {
  store = next;
}
