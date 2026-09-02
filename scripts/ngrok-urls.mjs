#!/usr/bin/env node
/**
 * Read the public URL from a running ngrok agent, write it into `.env` as PUBLIC_API_BASE_URL,
 * then print the Africa's Talking callback URLs.
 *
 * On the free tier the ngrok URL changes every restart, which means re-pasting three callbacks
 * into the dashboard each time. This removes the copy step; use `ngrok http --url=<static> 8787`
 * to remove the re-pasting too.
 *
 * Usage:
 *   ngrok http 8787          (in one terminal)
 *   npm run channels:ngrok   (in another)
 */
import {spawnSync} from 'node:child_process';
import {existsSync, readFileSync, writeFileSync} from 'node:fs';

const PORT = process.argv.find(a => /^\d+$/.test(a)) ?? '8787';
const AGENT_API = 'http://127.0.0.1:4040/api/tunnels';

const red = (s) => `\x1b[31m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;

let tunnels;
try {
  const res = await fetch(AGENT_API);
  if (!res.ok) throw new Error(`agent API returned ${res.status}`);
  tunnels = (await res.json()).tunnels ?? [];
} catch (err) {
  console.error(red('\nCould not reach the ngrok agent on http://127.0.0.1:4040.'));
  console.error(`\nStart it first, in its own terminal:\n\n  ngrok http ${PORT}\n`);
  console.error(dim(`(${err instanceof Error ? err.message : err})`));
  process.exit(1);
}

// Prefer an https tunnel pointing at our port; fall back to any https tunnel.
const forPort = tunnels.filter(t => String(t.config?.addr ?? '').endsWith(`:${PORT}`));
const chosen = (forPort.find(t => t.public_url?.startsWith('https://'))
  ?? tunnels.find(t => t.public_url?.startsWith('https://')));

if (!chosen) {
  console.error(red(`\nngrok is running but has no https tunnel for port ${PORT}.`));
  console.error(`\nOpen tunnels:\n${tunnels.map(t => `  ${t.public_url} -> ${t.config?.addr}`).join('\n') || '  (none)'}`);
  console.error(`\nStart one with:\n\n  ngrok http ${PORT}\n`);
  process.exit(1);
}

const baseUrl = chosen.public_url.replace(/\/+$/, '');
if (!forPort.length) {
  console.log(dim(`Note: no tunnel explicitly bound to :${PORT}; using ${chosen.config?.addr ?? 'unknown target'}.`));
}

// --- write PUBLIC_API_BASE_URL into .env, preserving everything else -------------------------
const envPath = existsSync('.env') ? '.env' : existsSync('.env.local') ? '.env.local' : null;
if (!envPath) {
  console.error(red('\nNo .env or .env.local found. Run this from the repository root.'));
  process.exit(1);
}

const original = readFileSync(envPath, 'utf8');
const line = `PUBLIC_API_BASE_URL=${baseUrl}`;
const updated = /^PUBLIC_API_BASE_URL=.*$/m.test(original)
  ? original.replace(/^PUBLIC_API_BASE_URL=.*$/m, line)
  : `${original.endsWith('\n') ? original : `${original}\n`}${line}\n`;

if (updated !== original) {
  writeFileSync(envPath, updated);
  console.log(`Set PUBLIC_API_BASE_URL=${baseUrl} in ${envPath}`);
} else {
  console.log(`PUBLIC_API_BASE_URL already ${baseUrl}`);
}
// Only the URL printer reads PUBLIC_API_BASE_URL; the API itself never does, so there is nothing
// to restart. Say so, because "set an env var" normally implies a restart.
console.log(dim('No API restart needed — PUBLIC_API_BASE_URL is only used to build these URLs.'));

// --- delegate to the existing printer (it also enforces the secret checks) --------------------
process.env.PUBLIC_API_BASE_URL = baseUrl;
const result = spawnSync(process.execPath, ['scripts/print-channel-urls.mjs'], {stdio: 'inherit'});
process.exit(result.status ?? 0);
