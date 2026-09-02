/**
 * Load `.env` / `.env.local` from the repository root before anything reads `process.env`.
 *
 * The API runs with its workspace as the working directory (`services/api`), so the root env file
 * is not adjacent to it — walk up until one is found. Existing environment variables always win,
 * so a real deployment's injected config is never overridden by a stray local file.
 *
 * Import this for its side effect, first, ahead of any module that reads configuration.
 */
import {existsSync, readFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';

function findUpwards(fileName: string, from: string): string | null {
  let dir = resolve(from);
  for (;;) {
    const candidate = join(dir, fileName);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function apply(path: string): void {
  for (const rawLine of readFileSync(path, 'utf8').split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || process.env[key] !== undefined) continue;
    process.env[key] = line.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
  }
}

export function loadEnv(from: string = process.cwd()): string[] {
  const loaded: string[] = [];
  // `.env.local` first: when both define a key, the more specific file should win.
  for (const name of ['.env.local', '.env']) {
    const path = findUpwards(name, from);
    if (path) { apply(path); loaded.push(path); }
  }
  return loaded;
}
