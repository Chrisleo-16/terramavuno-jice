/**
 * Static import audit for apps/globe.
 *
 * Because dependencies are installed once by the integration agent (no local
 * `npm install`), this script substitutes for a real boot: it resolves every
 * import specifier in `src/**` and `index.html` against the files that
 * actually survived the God's Eye View strip, and cross-checks bare package
 * specifiers against package.json.
 *
 * Usage: `node audit-imports.mjs` from apps/globe.
 */

import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const rel = (p) => path.relative(root, p).split(path.sep).join('/');

const files = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else files.push(full);
  }
})(path.join(root, 'src'));
files.push(path.join(root, 'index.html'));

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const deps = new Set([
  ...Object.keys(pkg.dependencies || {}),
  ...Object.keys(pkg.devDependencies || {}),
]);

/**
 * Import-specifier patterns. The "middle" of a static import/export clause is
 * matched with `[^;'"]*?` rather than `[\s\S]*?` on purpose: a greedy
 * any-character middle happily jumps from an `export const X = [` over many
 * lines into an unrelated string literal, and reports its contents as a
 * package name.
 */
const SPEC_PATTERNS = [
  // import x from 'y' / import {a,b} from 'y' / import 'y'
  /\bimport\s+(?:[^;'"]*?\s+from\s*)?['"]([^'"]+)['"]/g,
  // export { a } from 'y' / export * from 'y'
  /\bexport\s+[^;'"]*?\s+from\s*['"]([^'"]+)['"]/g,
  // await import('y')
  /\bimport\s*\(\s*['"]([^'"]+)['"]/g,
];

const unresolved = new Set();
const bare = new Map();
const importedLocal = new Set();

for (const file of files) {
  if (!/\.(m?js|html)$/.test(file)) continue;
  const source = fs.readFileSync(file, 'utf8');
  const specs = [];
  for (const pattern of SPEC_PATTERNS) {
    pattern.lastIndex = 0;
    let hit;
    while ((hit = pattern.exec(source))) specs.push(hit[1]);
  }
  for (const spec of specs) {
    if (!spec || /^(https?:|data:|blob:|node:)/.test(spec)) continue;
    if (spec.startsWith('.') || spec.startsWith('/')) {
      const base = spec.startsWith('/') ? root : path.dirname(file);
      const target = path.resolve(base, spec.replace(/^\//, ''));
      const candidates = [
        target,
        `${target}.js`,
        `${target}.mjs`,
        `${target}.json`,
        path.join(target, 'index.js'),
      ];
      const hit = candidates.find(
        (c) => fs.existsSync(c) && fs.statSync(c).isFile(),
      );
      if (hit) importedLocal.add(rel(hit));
      else unresolved.add(`${rel(file)} -> ${spec}`);
    } else {
      const name = spec.startsWith('@')
        ? spec.split('/').slice(0, 2).join('/')
        : spec.split('/')[0];
      if (!bare.has(name)) bare.set(name, new Set());
      bare.get(name).add(rel(file));
    }
  }
}

console.log('--- UNRESOLVED LOCAL IMPORTS ---');
console.log(unresolved.size ? [...unresolved].sort().join('\n') : '(none)');

console.log('\n--- BARE PACKAGE IMPORTS ---');
for (const [name, importers] of [...bare].sort()) {
  const status = deps.has(name) ? 'OK' : 'MISSING-FROM-PACKAGE-JSON';
  console.log(`${status}  ${name}  <- ${[...importers].sort().join(', ')}`);
}

console.log('\n--- DECLARED DEPS NEVER IMPORTED ---');
const unusedDeps = [...deps].sort().filter((d) => !bare.has(d));
console.log(unusedDeps.length ? unusedDeps.join('\n') : '(none)');

console.log('\n--- MODULES NEVER IMPORTED (orphan candidates) ---');
const orphans = files
  .map(rel)
  .filter((r) => /\.js$/.test(r) && r !== 'src/main.js' && !importedLocal.has(r))
  .sort();
console.log(orphans.length ? orphans.join('\n') : '(none)');

if (unresolved.size) process.exitCode = 1;
