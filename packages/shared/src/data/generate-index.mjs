#!/usr/bin/env node
/**
 * Regenerates ./index.ts from ./kilimo-fallback.json (the human-editable
 * source of truth), using _header.ts.txt (types) and _footer.ts.txt
 * (convenience exports). Run after any edit to kilimo-fallback.json:
 *
 *   node packages/shared/src/data/generate-index.mjs
 *
 * The consistency test (data-consistency.test.ts) fails when the two drift.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dir = path.dirname(fileURLToPath(import.meta.url));
const [header, footer, json] = await Promise.all([
  readFile(path.join(dir, '_header.ts.txt'), 'utf8'),
  readFile(path.join(dir, '_footer.ts.txt'), 'utf8'),
  readFile(path.join(dir, 'kilimo-fallback.json'), 'utf8'),
]);

const data = JSON.parse(json); // validate + normalise formatting
const literal = JSON.stringify(data, null, 2);
const out = `${header}export const KILIMO_FALLBACK: KilimoFallback = ${literal};\n\n${footer}`;
await writeFile(path.join(dir, 'index.ts'), out);
console.log(`[generate-index] wrote index.ts (${out.length} chars) from kilimo-fallback.json`);
