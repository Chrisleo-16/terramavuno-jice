import { describe, expect, it } from 'vitest';
import {
  authorityNotice,
  daysUntil,
  formatEat,
  formatMeetingForSms,
  formatMeetingForWhatsApp,
  formatMeetingsForUssd,
  isUpcoming,
  meetingsDueForReminder,
  parseRsvp,
  rsvpAcknowledgement,
  upcomingForWard,
} from './meetings.js';
import type { Meeting } from './types.js';
import { septetLength } from '../sms.js';
import { USSD_MAX_CHARS } from '../ussd.js';

const NOW = new Date('2026-09-02T09:00:00.000Z');

function meeting(overrides: Partial<Meeting> = {}): Meeting {
  return {
    id: 'm-1',
    title: 'Fertilizer collection briefing',
    agenda: 'Collection dates and what to bring.',
    mode: 'physical',
    authority: 'official',
    status: 'scheduled',
    startsAt: '2026-09-09T07:00:00.000Z',
    durationMinutes: 60,
    wardCode: '0539',
    wardName: "Ng'araria",
    location: { venue: 'Kandara Ward Agricultural Office', lat: -0.85, lon: 36.95 },
    joinUrl: null,
    organiser: 'Kandara Ward Agricultural Office',
    citation: 'MoALD ward office notice, 2026-09-02',
    createdAt: '2026-09-02T06:00:00.000Z',
    ...overrides,
  };
}

describe('formatEat', () => {
  it('shifts UTC to East Africa Time', () => {
    // 07:00Z is 10:00 in Nairobi (UTC+3).
    expect(formatEat('2026-09-09T07:00:00.000Z')).toBe('Wed 9 Sep, 10:00 EAT');
  });

  it('can omit the date', () => {
    expect(formatEat('2026-09-09T07:00:00.000Z', { withDate: false })).toBe('10:00 EAT');
  });

  it('rolls over the date when the shift crosses midnight', () => {
    // 22:30Z on the 9th is 01:30 on the 10th in Nairobi.
    expect(formatEat('2026-09-09T22:30:00.000Z')).toBe('Thu 10 Sep, 01:30 EAT');
  });

  it('does not throw on an unparseable instant', () => {
    expect(formatEat('not-a-date')).toBe('time unknown');
  });
});

describe('upcomingForWard', () => {
  it('keeps only future, scheduled meetings', () => {
    const past = meeting({ id: 'past', startsAt: '2026-08-01T07:00:00.000Z' });
    const cancelled = meeting({ id: 'cancelled', status: 'cancelled' });
    const live = meeting({ id: 'live' });
    expect(upcomingForWard([past, cancelled, live], '0539', NOW).map((m) => m.id)).toEqual(['live']);
  });

  it('includes county-wide meetings for every ward', () => {
    const countyWide = meeting({ id: 'county', wardCode: null, wardName: null });
    const otherWard = meeting({ id: 'other', wardCode: '0540' });
    const ids = upcomingForWard([countyWide, otherWard], '0539', NOW).map((m) => m.id);
    expect(ids).toEqual(['county']);
  });

  it('sorts soonest first and breaks ties on id so ordering is stable', () => {
    const b = meeting({ id: 'b', startsAt: '2026-09-09T07:00:00.000Z' });
    const a = meeting({ id: 'a', startsAt: '2026-09-09T07:00:00.000Z' });
    const early = meeting({ id: 'early', startsAt: '2026-09-03T07:00:00.000Z' });
    const sorted = upcomingForWard([b, a, early], '0539', NOW).map((m) => m.id);
    expect(sorted).toEqual(['early', 'a', 'b']);
  });

  it('a meeting starting exactly now still counts as upcoming', () => {
    const exact = meeting({ startsAt: NOW.toISOString() });
    expect(isUpcoming(exact, NOW)).toBe(true);
  });
});

describe('daysUntil', () => {
  it('counts whole days', () => {
    expect(daysUntil(meeting(), NOW)).toBe(6);
  });

  it('goes negative once the meeting has passed', () => {
    expect(daysUntil(meeting({ startsAt: '2026-08-01T07:00:00.000Z' }), NOW)).toBeLessThan(0);
  });
});

describe('formatMeetingForWhatsApp', () => {
  it('leads with CANCELLED and never shows the venue first', () => {
    const text = formatMeetingForWhatsApp(meeting({ status: 'cancelled' }));
    expect(text).toContain('*CANCELLED*');
    expect(text).not.toContain('Venue:');
    // The cancellation must appear before anything actionable.
    expect(text.indexOf('CANCELLED')).toBeLessThan(text.indexOf('will NOT take place'));
  });

  it('includes the venue for a physical meeting', () => {
    const text = formatMeetingForWhatsApp(meeting());
    expect(text).toContain('Venue: Kandara Ward Agricultural Office');
    expect(text).toContain('Wed 9 Sep, 10:00 EAT');
  });

  it('includes the join link for an online meeting', () => {
    const text = formatMeetingForWhatsApp(
      meeting({ mode: 'online', joinUrl: 'https://meet.example/abc', location: null }),
    );
    expect(text).toContain('Join: https://meet.example/abc');
  });

  it('says a link is coming when an online meeting has none yet', () => {
    const text = formatMeetingForWhatsApp(meeting({ mode: 'online', joinUrl: null, location: null }));
    expect(text).toContain('joining link to follow');
  });

  it('offers both routes for a hybrid meeting', () => {
    const text = formatMeetingForWhatsApp(
      meeting({ mode: 'hybrid', joinUrl: 'https://meet.example/abc' }),
    );
    expect(text).toContain('Venue: Kandara Ward Agricultural Office');
    expect(text).toContain('Or join: https://meet.example/abc');
  });

  it('labels a community meeting as not official', () => {
    const text = formatMeetingForWhatsApp(meeting({ authority: 'community' }));
    expect(text).toContain('COMMUNITY NOTICE');
    expect(text).not.toContain('Announced by the programme office');
  });

  it('always carries the citation', () => {
    expect(formatMeetingForWhatsApp(meeting())).toContain('MoALD ward office notice, 2026-09-02');
  });
});

describe('formatMeetingForSms', () => {
  it('fits a single billed segment for a typical meeting', () => {
    expect(septetLength(formatMeetingForSms(meeting()))).toBeLessThanOrEqual(160);
  });

  it('stays inside the GSM-7 alphabet so it is never billed as UCS-2', () => {
    // An en dash or smart quote would silently halve the capacity.
    const text = formatMeetingForSms(meeting({ title: 'Briefing — “collection”' }));
    expect(text).not.toMatch(/[—“”]/);
  });

  it('leads with CANCELLED', () => {
    expect(formatMeetingForSms(meeting({ status: 'cancelled' }))).toMatch(/^CANCELLED:/);
  });

  it('omits the join URL, which is expensive and unreliable on a feature phone', () => {
    const text = formatMeetingForSms(
      meeting({ mode: 'online', joinUrl: 'https://meet.example/abc', location: null }),
    );
    expect(text).not.toContain('https://');
    expect(text).toContain('link sent on WhatsApp');
  });

  it('flags a community notice', () => {
    expect(formatMeetingForSms(meeting({ authority: 'community' }))).toContain('not official');
  });
});

describe('formatMeetingsForUssd', () => {
  it('never exceeds the 182-character USSD limit, prefix included', () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      meeting({ id: `m-${String(i)}`, title: `Ward planning meeting number ${String(i)}` }),
    );
    const page = formatMeetingsForUssd(many, 'CON ');
    expect(page.length).toBeLessThanOrEqual(USSD_MAX_CHARS);
  });

  it('says how many meetings it dropped rather than truncating mid-word', () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      meeting({ id: `m-${String(i)}`, title: `Ward planning meeting number ${String(i)}` }),
    );
    const page = formatMeetingsForUssd(many, 'CON ');
    expect(page).toMatch(/\+\d+ more$/);
    // No line may be left dangling without its venue.
    expect(page.endsWith('...')).toBe(false);
  });

  it('handles an empty list', () => {
    expect(formatMeetingsForUssd([], 'END ')).toContain('No meetings scheduled');
  });

  it('falls back to a count when even one meeting will not fit', () => {
    const huge = meeting({ title: 'x'.repeat(400) });
    const page = formatMeetingsForUssd([huge], 'END ');
    expect(page.length).toBeLessThanOrEqual(USSD_MAX_CHARS);
    expect(page).toContain('Check SMS');
  });

  it('keeps the prefix it was given', () => {
    expect(formatMeetingsForUssd([meeting()], 'CON ')).toMatch(/^CON /);
    expect(formatMeetingsForUssd([meeting()], 'END ')).toMatch(/^END /);
  });
});

describe('parseRsvp', () => {
  it('accepts English and Kiswahili', () => {
    expect(parseRsvp('YES')).toBe('yes');
    expect(parseRsvp('ndio')).toBe('yes');
    expect(parseRsvp('Hapana')).toBe('no');
    expect(parseRsvp('labda')).toBe('maybe');
  });

  it('accepts menu digits', () => {
    expect(parseRsvp('1')).toBe('yes');
    expect(parseRsvp('2')).toBe('no');
    expect(parseRsvp('3')).toBe('maybe');
  });

  it('reads only the first word so trailing chatter does not break it', () => {
    expect(parseRsvp('yes please, I will come')).toBe('yes');
  });

  it('returns null for anything ambiguous — never rounds up to yes', () => {
    expect(parseRsvp('perhaps not')).toBeNull();
    expect(parseRsvp('')).toBeNull();
    expect(parseRsvp('????')).toBeNull();
  });
});

describe('rsvpAcknowledgement', () => {
  it('confirms attendance', () => {
    expect(rsvpAcknowledgement(meeting(), 'yes')).toContain('Confirmed');
  });

  it('is GSM-7 safe', () => {
    const text = rsvpAcknowledgement(meeting({ title: 'Briefing — “x”' }), 'no');
    expect(text).not.toMatch(/[—“”]/);
  });
});

describe('meetingsDueForReminder', () => {
  it('fires at 7 days and 1 day out', () => {
    const sevenDays = meeting({ id: 'seven', startsAt: '2026-09-09T09:00:00.000Z' });
    const oneDay = meeting({ id: 'one', startsAt: '2026-09-03T09:00:00.000Z' });
    const due = meetingsDueForReminder([sevenDays, oneDay], new Set(), NOW);
    expect(due.map((d) => `${d.meeting.id}@${String(d.offsetDays)}`)).toEqual([
      'seven@7',
      'one@1',
    ]);
  });

  it('does not fire twice for the same meeting and offset', () => {
    const soon = meeting({ id: 'one', startsAt: '2026-09-03T09:00:00.000Z' });
    const due = meetingsDueForReminder([soon], new Set(['one:1']), NOW);
    expect(due).toEqual([]);
  });

  it('ignores cancelled and past meetings', () => {
    const cancelled = meeting({ id: 'c', status: 'cancelled', startsAt: '2026-09-03T09:00:00.000Z' });
    const past = meeting({ id: 'p', startsAt: '2026-08-01T09:00:00.000Z' });
    expect(meetingsDueForReminder([cancelled, past], new Set(), NOW)).toEqual([]);
  });

  it('does not fire at an offset we do not schedule', () => {
    const threeDays = meeting({ startsAt: '2026-09-05T09:00:00.000Z' });
    expect(meetingsDueForReminder([threeDays], new Set(), NOW)).toEqual([]);
  });
});

describe('authorityNotice', () => {
  it('distinguishes official from community', () => {
    expect(authorityNotice('official')).toContain('programme office');
    expect(authorityNotice('community')).toContain('COMMUNITY NOTICE');
  });
});
