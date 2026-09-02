#!/usr/bin/env node
/**
 * Prints the exact callback URLs to paste into the Africa's Talking dashboard, and refuses to
 * print anything if the webhook token is missing or still a placeholder.
 *
 * Usage: node scripts/print-channel-urls.mjs   (reads .env / .env.local if present)
 */
import {readFileSync, existsSync} from 'node:fs';

for (const file of ['.env', '.env.local']) {
  if (!existsSync(file)) continue;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const base = (process.env.PUBLIC_API_BASE_URL || '').trim().replace(/\/+$/, '');
const token = (process.env.CHANNEL_WEBHOOK_TOKEN || '').trim();
const problems = [];
if (!base) problems.push('PUBLIC_API_BASE_URL is not set.');
else if (!base.startsWith('https://')) problems.push(`PUBLIC_API_BASE_URL is not https (${base}). Africa's Talking will post credentials-adjacent data in the clear.`);
if (!token) problems.push('CHANNEL_WEBHOOK_TOKEN is not set — webhooks will return 503.');
else if (token.length < 24) problems.push(`CHANNEL_WEBHOOK_TOKEN is only ${token.length} characters. Use at least 24 random characters; it is the only authentication on these endpoints.`);
if (!process.env.FIELD_REPORT_SALT?.trim()) problems.push('FIELD_REPORT_SALT is not set — reporter identities would be hashed with the public development salt.');

if (problems.length) {
  console.error('Cannot print callback URLs:\n' + problems.map(p => `  - ${p}`).join('\n'));
  console.error('\nGenerate a secret:  node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
  process.exit(1);
}

console.log(`Paste these into the Africa's Talking dashboard.
The token is a secret: it is the only thing authenticating these endpoints.

  USSD callback            ${base}/channels/${token}/ussd
  Incoming SMS callback    ${base}/channels/${token}/sms/inbound
  Delivery report callback ${base}/channels/${token}/sms/delivery

Dashboard paths:
  USSD      -> USSD > Create/Edit service code > Callback URL   (must be reachable over HTTPS)
  SMS in    -> SMS > SMS Callback URLs > Incoming Messages
  Delivery  -> SMS > SMS Callback URLs > Delivery Reports

Also restrict inbound traffic to Africa's Talking source IPs at your edge/proxy — AT does not
sign its callbacks, so the token is the only check this API can make. Confirm the current IP
list in your dashboard; it changes.`);
