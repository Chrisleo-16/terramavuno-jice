/**
 * Static DOM-contract audit for apps/globe.
 *
 * The God's Eye View `index.html` was trimmed hard (every panel whose layer
 * this fork deleted went with it). The matching failure mode is a retained
 * module reaching for an element that no longer exists and throwing during
 * boot, so this script cross-checks every `getElementById`/`querySelector('#id')`
 * target in `src/**` against the ids actually present in `index.html`.
 *
 * A "missing" id is only a real bug when the call site dereferences the result
 * without a null guard, so the report prints the guard status of each line.
 *
 * Usage: `node audit-dom.mjs` from apps/globe.
 */

import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const htmlIds = new Set(
  [...html.matchAll(/id=["']([^"']+)["']/g)].map((m) => m[1]),
);

/**
 * Ids that legitimately do not appear in index.html because a module or an
 * asset creates them. Collected rather than hardcoded where possible:
 *  - every `id="..."` inside a JS template literal (hud.js injects its whole
 *    corner-bracket HUD into #intel-hud; the annotation renderers inject their
 *    own <style> and SVG roots),
 *  - every `id="..."` inside the SVG assets under public/ (logoGaze reaches
 *    into logo.svg's #globe / #globe_cage groups).
 */
const injectedIds = new Set();
const collectIds = (text) => {
  for (const m of text.matchAll(/id=["']([^"']+)["']/g)) injectedIds.add(m[1]);
};
for (const asset of fs.readdirSync(path.join(root, 'public'))) {
  if (asset.endsWith('.svg')) {
    collectIds(fs.readFileSync(path.join(root, 'public', asset), 'utf8'));
  }
}

const files = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.m?js$/.test(entry.name)) files.push(full);
  }
})(path.join(root, 'src'));

const BY_ID = /getElementById\(\s*['"`]([^'"`]+)['"`]\s*\)/g;
const BY_SELECTOR = /querySelector(?:All)?\(\s*['"`]#([A-Za-z0-9_-]+)['"`]\s*\)/g;

/** Elements created at runtime by src/main.js rather than authored in HTML. */
const RUNTIME_CREATED = new Set(['cesium-credits']);

// First pass: every id any module writes into the DOM as markup.
for (const file of files) collectIds(fs.readFileSync(file, 'utf8'));

const findings = [];

for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  const lines = source.split('\n');
  for (const pattern of [BY_ID, BY_SELECTOR]) {
    pattern.lastIndex = 0;
    let hit;
    while ((hit = pattern.exec(source))) {
      const id = hit[1];
      if (htmlIds.has(id) || RUNTIME_CREATED.has(id) || injectedIds.has(id)) continue;
      const lineNo = source.slice(0, hit.index).split('\n').length;
      const line = lines[lineNo - 1].trim();
      // Heuristic guard detection: optional chaining, a null/if check, or an
      // assignment that is tested before use on the same line.
      const guarded = /\?\./.test(line) || /\|\||&&|if\s*\(|\?\s|return\s/.test(line);
      findings.push({
        file: path.relative(root, file).split(path.sep).join('/'),
        lineNo,
        id,
        guarded,
        line: line.slice(0, 120),
      });
    }
  }
}

console.log(`index.html declares ${htmlIds.size} ids.`);
console.log('--- DOM lookups with no matching id in index.html ---');
if (!findings.length) {
  console.log('(none)');
} else {
  for (const f of findings.sort((a, b) => a.file.localeCompare(b.file) || a.lineNo - b.lineNo)) {
    console.log(`${f.guarded ? 'guarded  ' : 'UNGUARDED'} ${f.file}:${f.lineNo}  #${f.id}\n    ${f.line}`);
  }
}
const unguarded = findings.filter((f) => !f.guarded);
console.log(`\n${findings.length} missing-id lookups, ${unguarded.length} without an obvious null guard.`);
if (unguarded.length) process.exitCode = 1;
