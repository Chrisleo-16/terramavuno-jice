/**
 * Validates packages/shared/src/data/kilimo-fallback.json against the shapes
 * the eligibility engine expects, and runs the engine over every synthetic
 * farmer so a malformed snapshot fails here rather than on stage.
 *
 * Usage: npm run validate:data   (requires: npm run build --workspace @terramavuno/shared)
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const snap = JSON.parse(
  readFileSync(path.join(root, 'packages/shared/src/data/kilimo-fallback.json'), 'utf8'),
);

const problems = [];
const need = (cond, msg) => { if (!cond) problems.push(msg); };

need(snap.programme, 'missing programme');
need(Array.isArray(snap.prices) && snap.prices.length, 'missing prices');
need(Array.isArray(snap.depots) && snap.depots.length, 'missing depots');
need(Array.isArray(snap.farmers) && snap.farmers.length, 'missing farmers');

for (const d of snap.depots ?? []) {
  need(typeof d.lat === 'number' && typeof d.lon === 'number', `depot ${d.id}: bad coords`);
  need(['in_stock', 'low', 'unknown'].includes(d.stockStatus), `depot ${d.id}: bad stockStatus`);
  need(d.evidence?.authority && d.evidence?.derivation, `depot ${d.id}: missing evidence tag`);
}
for (const f of snap.farmers ?? []) {
  need(/^K-\d{3}$/.test(f.token), `farmer ${f.token}: token must look like K-001`);
  need(!('name' in f) && !('nationalId' in f) && !('phone' in f), `farmer ${f.token}: PII field present`);
}

const { evaluateFarmer, SIJUI_TEXT } = await import('@terramavuno/shared');
const now = '2026-09-02T09:00:00Z';
let sijuiSeen = false;
for (const farmer of snap.farmers ?? []) {
  const d = evaluateFarmer({
    farmer, programme: snap.programme, prices: snap.prices, depots: snap.depots, now,
  });
  need(d.conclusion, `${farmer.token}: engine returned no conclusion`);
  need(d.trace?.every((t) => t.evidence?.sourceId), `${farmer.token}: a trace row has no citation`);
  if (d.sijui) { sijuiSeen = true; need(d.sijui === SIJUI_TEXT, `${farmer.token}: sijui text drifted`); }
  console.log(`  ${farmer.token.padEnd(6)} ${d.conclusion.padEnd(30)} eligible=${d.eligible}`);
}
need(sijuiSeen, 'no farmer produces the deliberate sijui case');

if (problems.length) {
  console.error('\nBUNDLED DATA INVALID:');
  for (const p of problems) console.error('  - ' + p);
  process.exit(1);
}
console.log('\nBundled dataset OK.');
