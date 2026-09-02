/**
 * Parse every ```mermaid block in the Markdown files given (default: README.md
 * and docs/*.md) and report which ones GitHub will refuse to render.
 *
 * GitHub renders Mermaid server-side and shows a bare "Unable to render rich
 * display" box on a parse error — no line number, no reason. This runs the same
 * parser locally so a broken diagram is caught before it ships.
 *
 * Requires the parser, which is NOT a dependency of this repo:
 *   npm install --no-save mermaid jsdom
 *
 * Usage:
 *   node scripts/validate-mermaid.mjs
 *   node scripts/validate-mermaid.mjs README.md docs/ARCHITECTURE.md
 */
import { readFileSync, existsSync, globSync } from 'node:fs';

const targets = process.argv.slice(2);
const files = targets.length
  ? targets
  : ['README.md', ...globSync('docs/*.md')].filter((f) => existsSync(f));

let JSDOM;
try {
  ({ JSDOM } = await import('jsdom'));
} catch {
  console.error(
    'Missing parser. Run:  npm install --no-save mermaid jsdom\n' +
      '(deliberately not a repo dependency — this is a docs lint, not a build step)',
  );
  process.exit(2);
}

// The DOM globals must exist BEFORE mermaid is imported. Mermaid pulls in
// DOMPurify at module scope, and DOMPurify binds to whatever `window` it can
// see at that moment — imported against a bare Node global it degrades to a
// no-op stub whose `addHook` is undefined, which then surfaces as a bogus
// "DOMPurify.addHook is not a function" on every diagram containing HTML.
// Import order is load-bearing here; do not hoist the mermaid import.
const dom = new JSDOM('<!doctype html><html><body></body></html>');
global.window = dom.window;
global.document = dom.window.document;
global.DOMParser = dom.window.DOMParser;
global.Node = dom.window.Node;
global.Element = dom.window.Element;
global.HTMLElement = dom.window.HTMLElement;
global.SVGElement = dom.window.SVGElement;
global.self = dom.window;

let mermaid;
try {
  mermaid = (await import('mermaid')).default;
} catch (error) {
  console.error(`Could not load mermaid: ${error?.message || error}`);
  console.error('Run:  npm install --no-save mermaid jsdom');
  process.exit(2);
}
mermaid.initialize({ startOnLoad: false });

/**
 * Pull every fenced mermaid block out of a Markdown file.
 * @param {string} file
 * @returns {{file: string, line: number, code: string}[]}
 */
function extractBlocks(file) {
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  const blocks = [];
  let current = null;
  lines.forEach((line, index) => {
    if (current === null && line.trim() === '```mermaid') {
      current = { file, line: index + 1, body: [] };
    } else if (current && line.trim() === '```') {
      blocks.push({ ...current, code: current.body.join('\n') });
      current = null;
    } else if (current) {
      current.body.push(line);
    }
  });
  return blocks;
}

const blocks = files.flatMap(extractBlocks);
if (blocks.length === 0) {
  console.log('No mermaid blocks found.');
  process.exit(0);
}

/**
 * GitHub renders Mermaid with `htmlLabels: false`. Under that setting a label
 * containing <b>, <i>, <code> etc. still PARSES cleanly — it just draws the tag
 * as literal text, so the diagram ships reading "<b>Tier 0</b>". Only <br> is
 * translated into a real line break. Parsing cannot catch this class of bug, so
 * lint for it separately.
 * @param {string} code
 * @returns {string[]} Offending tags, deduplicated.
 */
function htmlTagsInLabels(code) {
  const tags = code.match(/<\/?[a-zA-Z][^>]*>/g) || [];
  return [...new Set(tags.filter((t) => !/^<br\s*\/?>$/i.test(t)))];
}

const failures = [];
const warnings = [];
for (const block of blocks) {
  const tags = htmlTagsInLabels(block.code);
  if (tags.length) warnings.push({ ...block, tags });
  try {
    await mermaid.parse(block.code);
    const suffix = tags.length
      ? `  \x1b[33m(renders literally on GitHub: ${tags.slice(0, 4).join(' ')})\x1b[0m`
      : '';
    console.log(`  \x1b[32mOK  \x1b[0m ${block.file}:${block.line}${suffix}`);
  } catch (error) {
    const reason = String(error?.message || error).split('\n').slice(0, 6).join(' | ');
    failures.push({ ...block, reason });
    console.log(`  \x1b[31mFAIL\x1b[0m ${block.file}:${block.line}  ${reason.slice(0, 140)}`);
  }
}

console.log('');
console.log(`  ${blocks.length - failures.length}/${blocks.length} diagrams parse`);
if (warnings.length) {
  console.log(
    `  \x1b[33m${warnings.length} diagram(s) contain HTML GitHub will draw as literal text\x1b[0m`,
  );
  for (const w of warnings) console.log(`    ${w.file}:${w.line}  ${w.tags.join(' ')}`);
}
if (failures.length) {
  console.log('');
  for (const f of failures) {
    console.log(`--- ${f.file}:${f.line} ---`);
    console.log(f.reason);
  }
}
// HTML in labels is a rendering defect, not a parse error — fail on it too.
process.exit(failures.length || warnings.length ? 1 : 0);
