#!/usr/bin/env node
/**
 * print-elevenlabs-tools.mjs
 *
 * Prints the TerraMavuno tool registry in the ElevenLabs Agents client-tool
 * declaration shape as pretty JSON, so a human can paste each tool into the
 * ElevenLabs agent dashboard (Agent -> Tools -> Add tool -> Client tool).
 *
 * Usage (from the repo root):
 *   node scripts/print-elevenlabs-tools.mjs
 *   node scripts/print-elevenlabs-tools.mjs > elevenlabs-tools.json
 *
 * The single source of truth is packages/shared/src/tools/kilimo-tools.ts.
 * This script prefers the built output (packages/shared/dist) and falls back
 * to importing the TypeScript source directly via Node's type stripping
 * (Node >= 23.6, or >= 22.6 with --experimental-strip-types).
 *
 * Remember: tool and parameter names are case-sensitive and must exactly match
 * the clientTools handlers registered in the browser via
 * Conversation.startSession({ clientTools }).
 */

const CANDIDATES = [
  // Built output (run `npm run build --workspace @terramavuno/shared` first).
  new URL('../packages/shared/dist/tools/kilimo-tools.js', import.meta.url).href,
  // Direct TypeScript source (Node native type stripping).
  new URL('../packages/shared/src/tools/kilimo-tools.ts', import.meta.url).href,
];

let mod = null;
const errors = [];
for (const specifier of CANDIDATES) {
  try {
    mod = await import(specifier);
    break;
  } catch (err) {
    errors.push(`  ${specifier}\n    -> ${err.message}`);
  }
}

if (!mod) {
  console.error('Could not load the kilimo tool registry from any of:');
  console.error(errors.join('\n'));
  console.error('\nFix: build the shared package first:');
  console.error('  npm run build --workspace @terramavuno/shared');
  process.exit(1);
}

const tools = mod.toElevenLabsClientTools();
process.stdout.write(JSON.stringify(tools, null, 2) + '\n');
