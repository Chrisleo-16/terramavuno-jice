/**
 * Meeting selection and rendering — pure, I/O-free, so the wording a farmer
 * receives is unit-testable without a provider or a database.
 *
 * Three surfaces, three very different budgets:
 *   • WhatsApp — roomy, supports *bold*, can carry a join link.
 *   • SMS      — GSM-7 only, billed per 160 septets, so every word costs money.
 *   • USSD     — 182 characters INCLUDING the "CON "/"END " prefix, hard limit.
 *
 * All three obey the same honesty rule as the eligibility engine: a
 * community-announced meeting is never rendered as though the ward office
 * called it, and a cancelled meeting says CANCELLED first, before anything a
 * farmer might act on.
 */
import { toGsm7 } from '../sms.js';
// Single source of truth for the 3GPP 23.038 USSD cap — do not redefine it here.
import { USSD_MAX_CHARS } from '../ussd.js';
import type {
  Meeting,
  MeetingAuthority,
  MeetingMode,
  RsvpResponse,
} from './types.js';

/** Kenya is UTC+3 year-round with no daylight saving. */
export const NAIROBI_UTC_OFFSET_HOURS = 3;

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const;

/**
 * Format an instant in East Africa Time.
 *
 * Deliberately hand-rolled rather than `toLocaleString('en-KE', ...)`: ICU data
 * varies between Node builds and we are not willing to have a farmer's meeting
 * time depend on how the runtime was compiled.
 *
 * @param iso ISO 8601 instant.
 * @param opts `withDate` includes the weekday and date; time is always shown.
 * @returns e.g. "Tue 9 Sep, 10:00 EAT" or "10:00 EAT".
 */
export function formatEat(iso: string, opts: { withDate?: boolean } = {}): string {
  const { withDate = true } = opts;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'time unknown';
  const shifted = new Date(date.getTime() + NAIROBI_UTC_OFFSET_HOURS * 3600_000);
  const hh = String(shifted.getUTCHours()).padStart(2, '0');
  const mm = String(shifted.getUTCMinutes()).padStart(2, '0');
  const time = `${hh}:${mm} EAT`;
  if (!withDate) return time;
  const day = DAYS[shifted.getUTCDay()];
  const month = MONTHS[shifted.getUTCMonth()];
  return `${day} ${String(shifted.getUTCDate())} ${month}, ${time}`;
}

/** Whole days from `now` to the meeting; negative once it has started. */
export function daysUntil(meeting: Pick<Meeting, 'startsAt'>, now: Date = new Date()): number {
  const start = new Date(meeting.startsAt).getTime();
  if (Number.isNaN(start)) return Number.NaN;
  return Math.floor((start - now.getTime()) / 86_400_000);
}

/** Is this meeting still ahead of us and not cancelled? */
export function isUpcoming(meeting: Meeting, now: Date = new Date()): boolean {
  if (meeting.status !== 'scheduled') return false;
  const start = new Date(meeting.startsAt).getTime();
  return !Number.isNaN(start) && start >= now.getTime();
}

/**
 * Upcoming meetings for a ward, soonest first.
 *
 * County-wide meetings (`wardCode === null`) are included for every ward — a
 * farmer should not miss a county meeting because it was not filed against her
 * specific ward.
 *
 * Ordering is stable: equal start times fall back to id, so two meetings
 * scheduled for the same instant do not swap places between calls.
 */
export function upcomingForWard(
  meetings: readonly Meeting[],
  wardCode: string | null,
  now: Date = new Date(),
): Meeting[] {
  return meetings
    .filter((m) => isUpcoming(m, now))
    .filter((m) => m.wardCode === null || wardCode === null || m.wardCode === wardCode)
    .sort((a, b) => {
      const delta = new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime();
      return delta !== 0 ? delta : a.id.localeCompare(b.id);
    });
}

const MODE_LABEL: Record<MeetingMode, string> = {
  physical: 'In person',
  online: 'Online',
  hybrid: 'In person or online',
};

/**
 * The provenance line. A community meeting must never read like an official
 * summons, so the label is explicit rather than merely absent.
 */
export function authorityNotice(authority: MeetingAuthority): string {
  return authority === 'official'
    ? 'Announced by the programme office.'
    : 'COMMUNITY NOTICE - self-organised, not an official programme meeting.';
}

/** Where/how to attend, as one line. Returns null when there is nothing to say. */
function attendanceLine(meeting: Meeting): string | null {
  if (meeting.mode === 'online') {
    return meeting.joinUrl === null ? 'Online - joining link to follow.' : `Join: ${meeting.joinUrl}`;
  }
  const venue = meeting.location?.venue ?? null;
  if (meeting.mode === 'physical') return venue === null ? null : `Venue: ${venue}`;
  const parts: string[] = [];
  if (venue !== null) parts.push(`Venue: ${venue}`);
  if (meeting.joinUrl !== null) parts.push(`Or join: ${meeting.joinUrl}`);
  return parts.length > 0 ? parts.join('\n') : null;
}

/* ------------------------------------------------------------------ */
/* WhatsApp                                                            */
/* ------------------------------------------------------------------ */

const bold = (text: string): string => `*${text}*`;

/**
 * Render one meeting as a WhatsApp message.
 *
 * A cancelled meeting leads with CANCELLED: a farmer skimming a notification
 * must not read the venue first and set off.
 */
export function formatMeetingForWhatsApp(meeting: Meeting): string {
  const lines: string[] = [];
  lines.push(bold('Nielekeze by TerraMavuno'));
  lines.push('');

  if (meeting.status === 'cancelled') {
    lines.push(bold('CANCELLED'));
    lines.push(`${meeting.title} on ${formatEat(meeting.startsAt)} will NOT take place.`);
    lines.push('');
    lines.push(meeting.citation);
    return lines.join('\n');
  }

  lines.push(bold(meeting.title));
  lines.push(formatEat(meeting.startsAt));
  lines.push(`${MODE_LABEL[meeting.mode]} - ${String(meeting.durationMinutes)} min`);

  const where = attendanceLine(meeting);
  if (where !== null) {
    lines.push('');
    lines.push(where);
  }

  if (meeting.wardName !== null) {
    lines.push('');
    lines.push(`${bold('Ward:')} ${meeting.wardName}`);
  }

  if (meeting.agenda.trim().length > 0) {
    lines.push('');
    lines.push(`${bold('Agenda:')} ${meeting.agenda.trim()}`);
  }

  lines.push('');
  lines.push(`Called by: ${meeting.organiser}`);
  lines.push(authorityNotice(meeting.authority));
  lines.push('');
  lines.push('Reply YES, NO or MAYBE to confirm attendance.');
  lines.push('');
  lines.push(meeting.citation);

  return lines.join('\n');
}

/* ------------------------------------------------------------------ */
/* SMS                                                                 */
/* ------------------------------------------------------------------ */

/**
 * Render one meeting as SMS. Terse on purpose — every 160 septets is a billed
 * segment, and these go out to thousands of farmers.
 *
 * The join URL is omitted: links are unreliable on feature phones and
 * expensive in septets. Online joiners get the link over WhatsApp.
 */
export function formatMeetingForSms(meeting: Meeting): string {
  if (meeting.status === 'cancelled') {
    return toGsm7(
      `CANCELLED: ${meeting.title} on ${formatEat(meeting.startsAt)} will not take place.`,
    );
  }
  const parts = [`${meeting.title}`, formatEat(meeting.startsAt)];
  if (meeting.mode === 'online') {
    parts.push('Online - link sent on WhatsApp');
  } else if (meeting.location?.venue !== undefined && meeting.location.venue.length > 0) {
    parts.push(meeting.location.venue);
  }
  if (meeting.authority === 'community') parts.push('Community notice, not official');
  parts.push('Reply YES/NO/MAYBE');
  return toGsm7(parts.join('. ') + '.');
}

/* ------------------------------------------------------------------ */
/* USSD                                                                */
/* ------------------------------------------------------------------ */

/**
 * Render a short list of meetings for a USSD page.
 *
 * Truncation is deliberate and visible: we drop whole meetings off the end and
 * say how many were dropped, rather than cutting a line mid-word and leaving a
 * farmer with half a venue name.
 *
 * @param meetings Already filtered and sorted (see `upcomingForWard`).
 * @param prefix   'CON ' or 'END ' — counted against the 182-char budget.
 */
export function formatMeetingsForUssd(
  meetings: readonly Meeting[],
  prefix: 'CON ' | 'END ' = 'END ',
): string {
  if (meetings.length === 0) {
    return `${prefix}No meetings scheduled for your ward yet.`;
  }

  const header = 'Upcoming meetings:\n';
  const budget = USSD_MAX_CHARS - prefix.length;
  const rendered: string[] = [];
  let used = header.length;

  for (const [index, meeting] of meetings.entries()) {
    const where =
      meeting.mode === 'online' ? 'online' : (meeting.location?.venue ?? 'venue TBC');
    const line = `${String(index + 1)}. ${meeting.title}, ${formatEat(meeting.startsAt)}, ${where}\n`;
    // Leave room for a "+N more" footer if anything remains after this one.
    const remaining = meetings.length - index - 1;
    const footerCost = remaining > 0 ? `+${String(remaining)} more`.length : 0;
    if (used + line.length + footerCost > budget) break;
    rendered.push(line);
    used += line.length;
  }

  if (rendered.length === 0) {
    // Even one meeting did not fit — fall back to a bare count.
    return `${prefix}${String(meetings.length)} meeting(s) scheduled. Check SMS for details.`;
  }

  const dropped = meetings.length - rendered.length;
  const footer = dropped > 0 ? `+${String(dropped)} more` : '';
  return `${prefix}${header}${rendered.join('')}${footer}`.trimEnd();
}

/* ------------------------------------------------------------------ */
/* RSVP parsing                                                        */
/* ------------------------------------------------------------------ */

const RSVP_WORDS: Record<string, RsvpResponse> = {
  yes: 'yes', y: 'yes', ndio: 'yes', ndiyo: 'yes', sawa: 'yes', 1: 'yes',
  no: 'no', n: 'no', hapana: 'no', 2: 'no',
  maybe: 'maybe', m: 'maybe', labda: 'maybe', 3: 'maybe',
};

/**
 * Interpret a farmer's reply as an RSVP, in English or Kiswahili.
 *
 * Returns null for anything unrecognised — an ambiguous reply must NOT be
 * rounded to 'yes'. A wrongly recorded acceptance sends someone travelling.
 */
export function parseRsvp(text: string): RsvpResponse | null {
  const word = text.trim().toLowerCase().split(/\s+/)[0] ?? '';
  const cleaned = word.replace(/[^a-z0-9]/g, '');
  return RSVP_WORDS[cleaned] ?? null;
}

/** Acknowledgement sent back after an RSVP is recorded. */
export function rsvpAcknowledgement(meeting: Meeting, response: RsvpResponse): string {
  const when = formatEat(meeting.startsAt);
  if (response === 'yes') return toGsm7(`Confirmed: ${meeting.title}, ${when}. Karibu.`);
  if (response === 'no') return toGsm7(`Noted, you will not attend ${meeting.title}, ${when}.`);
  return toGsm7(`Noted as maybe for ${meeting.title}, ${when}.`);
}

/* ------------------------------------------------------------------ */
/* Reminders                                                           */
/* ------------------------------------------------------------------ */

/** Days before a meeting at which a reminder goes out. */
export const REMINDER_OFFSETS_DAYS = [7, 1] as const;

/**
 * Which meetings need a reminder right now.
 *
 * Matching is on WHOLE days remaining, and the caller is responsible for not
 * sending the same offset twice (the API records `remindersSent`). Reminding a
 * farmer twice is not merely untidy — outbound SMS is billed per segment.
 */
export function meetingsDueForReminder(
  meetings: readonly Meeting[],
  alreadySent: ReadonlySet<string>,
  now: Date = new Date(),
): { meeting: Meeting; offsetDays: number; key: string }[] {
  const due: { meeting: Meeting; offsetDays: number; key: string }[] = [];
  for (const meeting of meetings) {
    if (!isUpcoming(meeting, now)) continue;
    const remaining = daysUntil(meeting, now);
    for (const offset of REMINDER_OFFSETS_DAYS) {
      if (remaining !== offset) continue;
      const key = `${meeting.id}:${String(offset)}`;
      if (alreadySent.has(key)) continue;
      due.push({ meeting, offsetDays: offset, key });
    }
  }
  return due;
}
