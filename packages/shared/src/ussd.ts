/**
 * USSD menu as a pure function of Africa's Talking session input.
 *
 * AT posts `text` as every keypress in the session joined by `*` — "" on the first request, then
 * "1", then "1*makueni". The menu is therefore stateless per request: the full path is replayed
 * every time, so no server-side session store is needed to render the next screen. Session rows in
 * `conversations`/`sessions` exist for audit and for the report a session produces, not for state.
 *
 * The reply must be plain text prefixed with `CON ` (keep the session open) or `END ` (close it),
 * and the whole payload has to fit a single USSD string.
 */
import {matchCounty} from './counties.js';
import {findDemoSignal} from './demo-signals.js';
import {toGsm7} from './sms.js';

/** 3GPP 23.038 caps a USSD string at 182 GSM-7 septets, including the CON/END prefix. */
export const USSD_MAX_CHARS = 182;

export const reportCategories = [
  {choice: '1', key: 'rain-late',         label: 'Rains failed or late', indicator: 'rainfall_onset'},
  {choice: '2', key: 'crop-loss',         label: 'Crop loss',            indicator: 'crop_loss'},
  {choice: '3', key: 'water-point',       label: 'Water point not working', indicator: 'water_point_status'},
  {choice: '4', key: 'input-undelivered', label: 'Seed or input not delivered', indicator: 'input_delivery'}
] as const;
export type ReportCategory = (typeof reportCategories)[number];

export type UssdEffect =
  | {kind: 'field_report'; county: string; category: ReportCategory}
  | {kind: 'sms_advisory'; county: string};

export interface UssdResponse {
  type: 'CON' | 'END';
  message: string;
  /** Side effect the API layer must perform after replying. Rendering itself stays pure. */
  effect?: UssdEffect;
}

const MAIN_MENU = 'TerraMavuno\n1. Rain and drought\n2. Report from my farm\n3. Advisory by SMS';
const COUNTY_PROMPT = 'Enter your county name or code:';
const RETRY_PROMPT = 'County not recognised. Enter county name or code again:';

const con = (message: string, effect?: UssdEffect): UssdResponse => ({type: 'CON', message, effect});
const end = (message: string, effect?: UssdEffect): UssdResponse => ({type: 'END', message, effect});

/** Split AT's `text` into the ordered list of inputs the caller has entered this session. */
export function parseUssdInput(text: string | undefined): string[] {
  return (text ?? '').split('*').map(s => s.trim()).filter(s => s.length > 0);
}

function outlook(county: string): string {
  const s = findDemoSignal(county);
  if (!s) return `${county}: no signal in the demo set yet. Send a report to add ground truth from your farm.`;
  return `${s.name} DEMO BENCHMARK, not official:\nRain ${s.rain}mm\nDrought ${s.drought}/100 ${s.trend}\nVegetation ${s.ndvi.toFixed(2)}\nWater ${s.water}%`;
}

/**
 * Render the next USSD screen. `steps` is the caller's input history; the county prompt reads the
 * last entry so a mistyped county can be retried indefinitely without losing the branch.
 */
export function renderUssd(text: string | undefined): UssdResponse {
  const steps = parseUssdInput(text);
  if (steps.length === 0) return con(MAIN_MENU);
  const [branch] = steps;
  const last = steps[steps.length - 1];

  if (branch === '1') {
    if (steps.length === 1) return con(COUNTY_PROMPT);
    const county = matchCounty(last);
    return county ? end(outlook(county.name)) : con(RETRY_PROMPT);
  }

  if (branch === '2') {
    if (steps.length === 1) {
      return con(`What are you reporting?\n${reportCategories.map(c => `${c.choice}. ${c.label}`).join('\n')}`);
    }
    const category = reportCategories.find(c => c.choice === steps[1]);
    if (!category) return end('Invalid choice. Dial again to report from your farm.');
    if (steps.length === 2) return con(COUNTY_PROMPT);
    const county = matchCounty(last);
    if (!county) return con(RETRY_PROMPT);
    return end(
      `Recorded for ${county.name}: ${category.label}. Logged as unverified community evidence pending officer review. Asante.`,
      {kind: 'field_report', county: county.name, category}
    );
  }

  if (branch === '3') {
    if (steps.length === 1) return con(COUNTY_PROMPT);
    const county = matchCounty(last);
    if (!county) return con(RETRY_PROMPT);
    return end(`Advisory for ${county.name} is being sent by SMS.`, {kind: 'sms_advisory', county: county.name});
  }

  return end('Invalid choice. Dial again and choose 1, 2 or 3.');
}

/**
 * Serialise a response to the wire format. Truncates on a word boundary so a long county name can
 * never push the payload past the USSD limit and get the whole reply dropped by the carrier.
 */
export function renderUssdPayload(response: UssdResponse): string {
  const body = toGsm7(response.message);
  const room = USSD_MAX_CHARS - 4; // "CON " / "END "
  if (body.length <= room) return `${response.type} ${body}`;
  const cut = body.slice(0, room - 1);
  const boundary = cut.lastIndexOf(' ');
  const kept = (boundary > room * 0.6 ? cut.slice(0, boundary) : cut).trimEnd();
  return `${response.type} ${kept}.`;
}
