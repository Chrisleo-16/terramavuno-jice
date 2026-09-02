/**
 * SMS body construction and segmentation. Kept in `shared` and free of I/O so message length and
 * cost behaviour are unit-testable without touching a provider.
 *
 * Segment sizes are the GSM 03.38 / 3GPP 23.038 limits: 160 septets for a single GSM-7 message,
 * 153 per part once a User Data Header is added for concatenation; 70 and 67 respectively for
 * UCS-2. A single smart quote or accented character pushes the whole message to UCS-2 and more
 * than halves the capacity, which is why the templates below stay inside the GSM-7 alphabet.
 */
import {findDemoSignal} from './demo-signals.js';
import {matchCounty} from './counties.js';

const GSM7 = new Set(
  ("@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?" +
   "¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà").split('')
);
const GSM7_EXTENDED = new Set('^{}\\[~]|€'.split(''));

export function isGsm7(text: string): boolean {
  return [...text].every(ch => GSM7.has(ch) || GSM7_EXTENDED.has(ch));
}

/** Septet cost of a string: extended-table characters occupy two septets each. */
export function septetLength(text: string): number {
  return [...text].reduce((n, ch) => n + (GSM7_EXTENDED.has(ch) ? 2 : 1), 0);
}

/** Replace common non-GSM-7 punctuation so a message does not silently become UCS-2. */
export function toGsm7(text: string): string {
  return text
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/[\u00a0\u2007\u202f]/g, ' ');
}

export interface SmsSegmentation { parts: string[]; encoding: 'GSM-7' | 'UCS-2'; segments: number }

/**
 * Split a body into provider-ready parts. Parts after the first carry an `(i/n)` prefix, and the
 * prefix is counted against the limit so no part can overflow into an extra billed segment.
 */
export function segmentSms(body: string): SmsSegmentation {
  const text = toGsm7(body).trim();
  const gsm = isGsm7(text);
  const encoding = gsm ? 'GSM-7' : 'UCS-2';
  const single = gsm ? 160 : 70;
  const measure = (s: string) => (gsm ? septetLength(s) : [...s].length);
  if (measure(text) <= single) return {parts: [text], encoding, segments: 1};

  const multi = gsm ? 153 : 67;
  const words = text.split(/(\s+)/);
  const chunks: string[] = [];
  let current = '';
  const budget = () => multi - 8; // room for a "(nn/nn) " prefix
  for (const token of words) {
    if (measure(current + token) <= budget()) { current += token; continue; }
    if (current.trim()) chunks.push(current.trim());
    current = measure(token) > budget() ? '' : token.trimStart();
    if (!current && token.trim()) {
      // A single token longer than one part: hard-split it.
      let rest = token.trim();
      while (measure(rest) > budget()) {
        let cut = budget();
        while (cut > 0 && measure(rest.slice(0, cut)) > budget()) cut--;
        chunks.push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      current = rest;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  const parts = chunks.map((c, i) => `(${i + 1}/${chunks.length}) ${c}`);
  return {parts, encoding, segments: parts.length};
}

/**
 * Outbound advisory for a county. Demo-labelled: the channel must not imply an official forecast.
 *
 * Every advisory must fit one 160-septet segment — see the single-segment test. On a channel whose
 * whole justification is cost per farmer reached, a template that quietly spills into a second
 * segment doubles the price of the reach figure the simulator advertises. NDVI is omitted on
 * purpose: 0.74 carries no meaning on a feature phone and it costs characters that the actionable
 * return-path instruction needs.
 */
export function advisorySms(county: string): string {
  const s = findDemoSignal(county);
  if (!s) return toGsm7(`TerraMavuno: no signal for ${county} yet. Reply REPORT ${county} + what you see to add ground truth from your farm. STOP to opt out.`);
  return toGsm7(
    `TerraMavuno ${s.name} (DEMO, not official): rain ${s.rain}mm, drought ${s.drought}/100 ${s.trend}, water ${s.water}%. Reply REPORT ${s.name} + what you see. STOP to opt out.`
  );
}

/** Acknowledgement sent back to a farmer whose report was accepted. */
export function fieldReportAckSms(county: string): string {
  return toGsm7(`TerraMavuno: your report for ${county} was received and logged as unverified community evidence. An officer reviews it before it changes any figure. Asante.`);
}

export const SMS_OPT_OUT_KEYWORDS = ['stop', 'stopall', 'unsubscribe', 'quit', 'cancel', 'end'] as const;

export interface ParsedSmsCommand {
  kind: 'report' | 'outlook' | 'opt_out' | 'help';
  county?: string;
  note?: string;
}

/** Peel a county name (up to three tokens, longest first) off the front of a message body. */
function splitCountyPrefix(rest: string): {county: string; note: string} {
  const tokens = rest.split(/\s+/).filter(Boolean);
  for (const take of [3, 2, 1]) {
    if (tokens.length < take) continue;
    const candidate = tokens.slice(0, take).join(' ');
    if (matchCounty(candidate)) return {county: candidate, note: tokens.slice(take).join(' ')};
  }
  return {county: tokens[0] ?? '', note: tokens.slice(1).join(' ')};
}

/**
 * Parse an inbound SMS body. Deliberately forgiving: farmers do not type keywords precisely, and a
 * misparse should fall back to HELP rather than silently discard a report.
 */
export function parseSmsCommand(body: string): ParsedSmsCommand {
  const text = toGsm7(body).trim();
  const first = text.split(/\s+/)[0]?.toLowerCase() ?? '';
  if (SMS_OPT_OUT_KEYWORDS.includes(first as (typeof SMS_OPT_OUT_KEYWORDS)[number])) return {kind: 'opt_out'};
  const rest = text.slice(first.length).trim();
  if (first === 'report') {
    // "REPORT Homa Bay rains failed" — take the longest leading run of up to three tokens that
    // resolves to a real county, so two-word county names are not split into the note.
    const {county, note} = splitCountyPrefix(rest);
    return {kind: 'report', county, note};
  }
  if (first === 'outlook' || first === 'rain' || first === 'drought') return {kind: 'outlook', county: rest};
  if (!first || first === 'help') return {kind: 'help'};
  // Bare county name is the most common thing a farmer will send.
  return {kind: 'outlook', county: text};
}

export const SMS_HELP = toGsm7('TerraMavuno: send a county name for its outlook, or REPORT <county> <what you see> to log a field report. Reply STOP to opt out.');
