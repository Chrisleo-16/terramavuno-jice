/**
 * Meeting types — farmer-facing gatherings, online or physical.
 *
 * A meeting is an ANNOUNCEMENT, not a decision. It is deliberately kept out of
 * the eligibility engine: nothing here can change whether a farmer qualifies
 * for anything. What it shares with the engine is the provenance discipline —
 * a meeting announced by the ward agricultural office is `official`, a meeting
 * a farmer group self-organises is `community`, and the two are never rendered
 * as though they carry the same weight.
 */

/** Where a meeting happens. Online meetings carry a join URL, physical ones a venue. */
export type MeetingMode = 'physical' | 'online' | 'hybrid';

/**
 * Who announced the meeting. Mirrors the evidence model's `authority` axis:
 * `official` comes from a government or programme source, `community` is
 * self-reported and must always be labelled as such to the farmer.
 */
export type MeetingAuthority = 'official' | 'community';

/** Lifecycle. A cancelled meeting is kept, not deleted — farmers may have travelled. */
export type MeetingStatus = 'scheduled' | 'cancelled' | 'completed';

/** How a farmer answered an invitation. */
export type RsvpResponse = 'yes' | 'no' | 'maybe';

export interface MeetingLocation {
  /** Human-readable venue, e.g. "Kandara Ward Agricultural Office". */
  venue: string;
  lat: number | null;
  lon: number | null;
}

export interface Meeting {
  id: string;
  /** Short, farmer-facing title. Kept brief so it survives a 182-char USSD page. */
  title: string;
  agenda: string;
  mode: MeetingMode;
  authority: MeetingAuthority;
  status: MeetingStatus;
  /** ISO 8601 UTC instant the meeting starts. */
  startsAt: string;
  durationMinutes: number;
  /** Ward code this meeting serves, or null for a county-wide meeting. */
  wardCode: string | null;
  wardName: string | null;
  /** Present for `physical` and `hybrid`. */
  location: MeetingLocation | null;
  /** Present for `online` and `hybrid`. */
  joinUrl: string | null;
  /** Who called it, e.g. "Kandara Ward Agricultural Office". */
  organiser: string;
  /** Provenance sentence shown wherever the meeting is displayed. */
  citation: string;
  createdAt: string;
}

export interface MeetingRsvp {
  meetingId: string;
  /** Opaque farmer token (K-001) — never a name or a phone number. */
  farmerToken: string;
  response: RsvpResponse;
  respondedAt: string;
}

/** A meeting plus the viewer's own RSVP, when there is one. */
export interface MeetingWithRsvp extends Meeting {
  myRsvp: RsvpResponse | null;
}
