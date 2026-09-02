/**
 * Creates (or updates) the "Nielekeze by TerraMavuno" ElevenLabs
 * Conversational AI agent, wired to the SAME 8 client tools the Claude chat
 * loop uses, so voice and text can never drift apart.
 *
 * Requires an ElevenLabs API key with the `convai_write` permission
 * (Dashboard → Profile → API Keys → enable Conversational AI read + write).
 *
 * Usage:
 *   node scripts/create-elevenlabs-agent.mjs            # create or update
 *   node scripts/create-elevenlabs-agent.mjs --dry-run  # print the payload only
 *
 * Reads ELEVENLABS_API_KEY (and optionally ELEVENLABS_VOICE_ID,
 * ELEVENLABS_AGENT_ID) from the repo-root .env. On success it writes the new
 * ELEVENLABS_AGENT_ID back into .env so `npm run dev:api` picks it up.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENV_PATH = path.join(ROOT, '.env');
const API = 'https://api.elevenlabs.io/v1/convai/agents';
const DRY = process.argv.includes('--dry-run');

/* ------------------------------------------------------------------ env -- */
function readEnv() {
  if (!existsSync(ENV_PATH)) return {};
  const out = {};
  for (const line of readFileSync(ENV_PATH, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line.trim());
    if (m) out[m[1]] = m[2];
  }
  return out;
}

function writeEnvVar(key, value) {
  if (!existsSync(ENV_PATH)) return false;
  const src = readFileSync(ENV_PATH, 'utf8');
  const line = `${key}=${value}`;
  const next = new RegExp(`^${key}=.*$`, 'm').test(src)
    ? src.replace(new RegExp(`^${key}=.*$`, 'm'), line)
    : `${src.replace(/\s*$/, '')}\n${line}\n`;
  writeFileSync(ENV_PATH, next, 'utf8');
  return true;
}

const env = { ...readEnv(), ...process.env };
const apiKey = env.ELEVENLABS_API_KEY;
if (!apiKey && !DRY) {
  console.error('ELEVENLABS_API_KEY is not set (checked .env and the environment).');
  process.exit(1);
}

/* ------------------------------------------------------- shared contracts -- */
const shared = await import('@terramavuno/shared').catch(() => null);
if (!shared) {
  console.error('Could not import @terramavuno/shared. Run: npm run shared:build');
  process.exit(1);
}
const clientTools = shared.toElevenLabsClientTools();

// The voice-tuned variant of the same honesty contract the chat loop uses.
const VOICE_PROMPT = [
  'You are the voice of Nielekeze by TerraMavuno, a Kenyan fertilizer-subsidy navigator.',
  '',
  'THE ENGINE DECIDES, YOU EXPLAIN.',
  'Never work out eligibility yourself. Always call evaluate_farmer and restate the Decision it returns.',
  'Never state a number, price, allocation or depot that did not come from a tool result.',
  '',
  'HONESTY.',
  'Cite the authority and the date of what you say (for example "official, gazetted 14 August 2026").',
  'Say plainly when something is simulated demo data.',
  'If the Decision is cannot_determine, or carries a sijui note, say exactly that and stop.',
  'Never guess depot stock, prices, or whether someone is in the register.',
  'Never claim you did something on the map unless the tool call succeeded.',
  '',
  'DRIVE THE MAP.',
  'Call fly_to_location before you discuss a place. Use set_layer_visibility so the visible layers match your point.',
  'Call show_result_card immediately after evaluate_farmer returns.',
  '',
  'STYLE.',
  'You are speaking aloud to a smallholder farmer. Keep turns to two or three short sentences.',
  'Answer in clear English, then add ONE short Kiswahili summary line.',
  'Lead with the answer, then the reason. No lists, no markdown, no reading out URLs.',
].join('\n');

const FIRST_MESSAGE =
  'Karibu. Ask me about the 2026 fertilizer subsidy — I can check a farmer token like K-001 ' +
  'and tell you what the rules say, what you would pay, and where to go.';

const payload = {
  name: 'Nielekeze by TerraMavuno',
  conversation_config: {
    agent: {
      prompt: {
        prompt: VOICE_PROMPT,
        llm: 'gemini-2.0-flash',
        temperature: 0.3,
        tools: clientTools,
      },
      first_message: FIRST_MESSAGE,
      language: 'en',
    },
    tts: env.ELEVENLABS_VOICE_ID ? { voice_id: env.ELEVENLABS_VOICE_ID } : undefined,
    turn: { turn_timeout: 10 },
  },
  platform_settings: {
    // The browser fetches a server-signed URL from /api/voice/signed-url, so the
    // agent itself must stay private — never enable unauthenticated access.
    auth: { enable_auth: true },
  },
};

if (DRY) {
  console.log(JSON.stringify(payload, null, 2));
  console.log(`\n(${clientTools.length} client tools from the shared registry)`);
  process.exit(0);
}

/* ------------------------------------------------------------- create -- */
const existingId = env.ELEVENLABS_AGENT_ID;
const url = existingId ? `${API}/${existingId}` : `${API}/create`;
const method = existingId ? 'PATCH' : 'POST';

console.log(`${existingId ? 'Updating' : 'Creating'} agent with ${clientTools.length} client tools…`);

const res = await fetch(url, {
  method,
  headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
});

const text = await res.text();
if (!res.ok) {
  console.error(`\nHTTP ${res.status}`);
  try {
    const err = JSON.parse(text);
    const d = err.detail ?? err;
    console.error(`  ${d.message ?? text}`);
    if (String(d.status) === 'missing_permissions') {
      console.error('\n  Your API key lacks Conversational AI permissions.');
      console.error('  ElevenLabs → Profile → API Keys → edit the key →');
      console.error('  enable "Conversational AI" read AND write, then re-run.');
    }
  } catch {
    console.error(text.slice(0, 500));
  }
  process.exit(1);
}

const body = JSON.parse(text);
const agentId = body.agent_id ?? body.agentId ?? existingId;
console.log(`\nAgent ready: ${agentId}`);

if (writeEnvVar('ELEVENLABS_AGENT_ID', agentId)) {
  console.log('Wrote ELEVENLABS_AGENT_ID to .env');
}
console.log('\nNext: restart the API (npm run dev:api) and reload the globe.');
console.log('The SEMA mic button enables itself once /api/voice/signed-url returns 200.');
