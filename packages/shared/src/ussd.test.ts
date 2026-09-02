import {describe, expect, it} from 'vitest';
import {parseUssdInput, renderUssd, renderUssdPayload, USSD_MAX_CHARS} from './ussd.js';

describe('ussd menu', () => {
  it('shows the root menu on the first request', () => {
    const r = renderUssd('');
    expect(r.type).toBe('CON');
    expect(r.message).toContain('1. Rain and drought');
    expect(r.effect).toBeUndefined();
  });

  it('replays the whole keypress path from a single text field', () => {
    expect(parseUssdInput('2*1*makueni')).toEqual(['2', '1', 'makueni']);
    expect(parseUssdInput('')).toEqual([]);
    expect(parseUssdInput(undefined)).toEqual([]);
  });

  it('returns a county outlook and ends the session', () => {
    const r = renderUssd('1*makueni');
    expect(r.type).toBe('END');
    expect(r.message).toContain('Makueni');
    expect(r.message).toContain('DEMO BENCHMARK');
  });

  it('says so rather than inventing a signal for an uncovered county', () => {
    const r = renderUssd('1*kakamega');
    expect(r.type).toBe('END');
    expect(r.message).toContain('no signal in the demo set');
  });

  it('re-prompts without losing the branch when a county is mistyped', () => {
    const retry = renderUssd('1*zzzz');
    expect(retry.type).toBe('CON');
    expect(retry.message).toContain('not recognised');
    // The caller tries again; AT appends the new input to the same text field.
    const second = renderUssd('1*zzzz*kitui');
    expect(second.type).toBe('END');
    expect(second.message).toContain('Kitui');
  });

  it('emits a field-report effect at the end of the report branch', () => {
    expect(renderUssd('2').message).toContain('Rains failed or late');
    expect(renderUssd('2*1').message).toContain('county');
    const done = renderUssd('2*1*makueni');
    expect(done.type).toBe('END');
    expect(done.effect).toEqual({kind: 'field_report', county: 'Makueni', category: expect.objectContaining({key: 'rain-late', indicator: 'rainfall_onset'})});
  });

  it('emits an sms advisory effect', () => {
    expect(renderUssd('3*turkana').effect).toEqual({kind: 'sms_advisory', county: 'Turkana'});
  });

  it('rejects an out-of-range choice', () => {
    expect(renderUssd('9').type).toBe('END');
    expect(renderUssd('2*9').type).toBe('END');
  });

  it('matches counties by code and by two-word name', () => {
    expect(renderUssd('1*017').message).toContain('Makueni');
    expect(renderUssd('1*uasin gishu').message).toContain('Uasin Gishu');
  });

  it('never exceeds the USSD payload limit', () => {
    for (const text of ['', '1', '2', '2*1', '1*makueni', '2*1*makueni', '3*turkana', '1*zzzz', '9']) {
      const payload = renderUssdPayload(renderUssd(text));
      expect(payload.length).toBeLessThanOrEqual(USSD_MAX_CHARS);
      expect(payload).toMatch(/^(CON|END) /);
    }
  });

  it('truncates rather than overflowing the carrier limit', () => {
    const payload = renderUssdPayload({type: 'CON', message: 'x'.repeat(400)});
    expect(payload.length).toBeLessThanOrEqual(USSD_MAX_CHARS);
    expect(payload.startsWith('CON ')).toBe(true);
  });
});
