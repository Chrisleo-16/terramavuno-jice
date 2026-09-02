import {describe, expect, it} from 'vitest';
import {advisorySms, fieldReportAckSms, isGsm7, parseSmsCommand, segmentSms, toGsm7} from './sms.js';
import {counties} from './counties.js';
import {demoSignals} from './demo-signals.js';

describe('sms encoding', () => {
  it('keeps templates inside GSM-7 so they bill as one segment', () => {
    for (const body of [advisorySms('Makueni'), advisorySms('Kakamega'), fieldReportAckSms('Kitui')]) {
      expect(isGsm7(body)).toBe(true);
    }
  });

  it('detects UCS-2 and downgrades punctuation that would force it', () => {
    expect(isGsm7('Murang’a')).toBe(false);
    expect(isGsm7(toGsm7('Murang’a'))).toBe(true);
    expect(toGsm7('“quoted” — and…')).toBe('"quoted" - and...');
  });

  it('sends a short message as a single part', () => {
    const seg = segmentSms('Rain 412mm, drought 78/100.');
    expect(seg.segments).toBe(1);
    expect(seg.encoding).toBe('GSM-7');
    expect(seg.parts[0]).not.toContain('(1/');
  });

  it('splits a long message into numbered parts that each fit a segment', () => {
    const seg = segmentSms('word '.repeat(120));
    expect(seg.segments).toBeGreaterThan(1);
    for (const part of seg.parts) expect(part.length).toBeLessThanOrEqual(153);
    expect(seg.parts[0]).toMatch(/^\(1\/\d+\) /);
  });

  it('hard-splits a single token longer than one part', () => {
    const seg = segmentSms('x'.repeat(400));
    expect(seg.segments).toBeGreaterThan(1);
    for (const part of seg.parts) expect(part.length).toBeLessThanOrEqual(153);
  });

  it('uses the shorter UCS-2 limits when the body is not GSM-7', () => {
    const seg = segmentSms('汉'.repeat(100));
    expect(seg.encoding).toBe('UCS-2');
    expect(seg.segments).toBeGreaterThan(1);
  });
});

describe('inbound sms parsing', () => {
  it('reads a report with a single-word county', () => {
    expect(parseSmsCommand('REPORT Makueni rains failed twice')).toEqual({kind: 'report', county: 'Makueni', note: 'rains failed twice'});
  });

  it('does not split a two-word county into the note', () => {
    expect(parseSmsCommand('report homa bay borehole broken')).toEqual({kind: 'report', county: 'homa bay', note: 'borehole broken'});
    expect(parseSmsCommand('REPORT Uasin Gishu maize lodged')).toEqual({kind: 'report', county: 'Uasin Gishu', note: 'maize lodged'});
  });

  it('treats a bare county name as an outlook request', () => {
    expect(parseSmsCommand('Turkana')).toEqual({kind: 'outlook', county: 'Turkana'});
    expect(parseSmsCommand('outlook Kitui')).toEqual({kind: 'outlook', county: 'Kitui'});
  });

  it('recognises opt-out keywords case-insensitively', () => {
    for (const word of ['STOP', 'stop', 'Unsubscribe', 'QUIT']) expect(parseSmsCommand(word).kind).toBe('opt_out');
  });

  it('falls back to help on an empty body', () => {
    expect(parseSmsCommand('   ').kind).toBe('help');
    expect(parseSmsCommand('help').kind).toBe('help');
  });
});

describe('advisory content', () => {
  it('labels the figures as a demo benchmark and offers the return path', () => {
    const body = advisorySms('Makueni');
    expect(body).toContain('DEMO, not official');
    expect(body).toContain('REPORT Makueni');
    expect(body).toContain('STOP');
  });

  it('admits missing coverage instead of guessing', () => {
    expect(advisorySms('Wajir')).toContain('no signal for Wajir');
  });

  // Cost guard: the channel's whole case is cost per farmer reached, so an advisory that spills
  // into a second segment silently doubles it. Covers all 47 counties, not just the demo subset,
  // because the longest county names are outside it.
  it('fits every county advisory into a single billed segment', () => {
    const overflowing = counties
      .map(c => ({county: c.name, seg: segmentSms(advisorySms(c.name))}))
      .filter(x => x.seg.segments > 1 || x.seg.encoding !== 'GSM-7');
    expect(overflowing.map(x => `${x.county}: ${x.seg.segments}x ${x.seg.encoding}`)).toEqual([]);
  });

  it('fits the report acknowledgement into a single segment too', () => {
    for (const s of demoSignals) expect(segmentSms(fieldReportAckSms(s.name)).segments).toBe(1);
  });
});
