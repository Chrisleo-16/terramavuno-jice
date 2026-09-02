#!/usr/bin/env node
/**
 * Apply TerraMavuno migrations (and the idempotent seed) to a database.
 *
 * Safe by default: a bare run only *reports* — it lists local vs applied migrations and does a
 * `--dry-run` push. Nothing is written until you pass `--yes`. That is deliberate; this points at
 * a live project and migrations are not trivially reversible.
 *
 *   npm run db:status            what is applied where
 *   npm run db:push              dry run, prints what would change
 *   npm run db:push -- --yes     actually apply migrations + seed
 *   npm run db:push -- --local   reset the local Docker stack instead (destructive, local only)
 *
 * Credentials come from .env / .env.local, either:
 *   SUPABASE_PROJECT_REF + SUPABASE_DB_PASSWORD   (preferred: the CLI handles URL encoding)
 *   or DATABASE_URL / SUPABASE_DB_URL             (must be percent-encoded)
 *
 * Note: the password is passed as a CLI flag, so it is briefly visible in the process list on a
 * shared machine. Prefer a dedicated CI runner or a short-lived password for production pushes.
 */
import {spawnSync} from 'node:child_process';
import {existsSync, readFileSync, readdirSync} from 'node:fs';

// ---------------------------------------------------------------------------------------------

function loadEnvFiles() {
  for (const file of ['.env', '.env.local']) {
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const apply = has('--yes');
const local = has('--local');
const withSeed = !has('--no-seed');

const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;

function die(message, hint) {
  console.error(red(`\n${message}`));
  if (hint) console.error(`\n${hint}`);
  process.exit(1);
}

/** Run the Supabase CLI, inheriting stdio so the user sees its real output. */
function cli(cliArgs, {allowFailure = false} = {}) {
  const printable = cliArgs.map((a, i) =>
    cliArgs[i - 1] === '--password' || cliArgs[i - 1] === '--db-url' ? '********' : a);
  console.log(dim(`\n$ supabase ${printable.join(' ')}`));
  const result = spawnSync('npx', ['--no-install', 'supabase', ...cliArgs], {
    stdio: 'inherit',
    shell: process.platform === 'win32'
  });
  if (result.status !== 0 && !allowFailure) {
    die(`supabase ${printable.join(' ')} failed with exit code ${result.status}.`);
  }
  return result.status === 0;
}

// ---------------------------------------------------------------------------------------------

loadEnvFiles();

const migrationsDir = 'supabase/migrations';
if (!existsSync(migrationsDir)) die(`No ${migrationsDir} directory. Run this from the repository root.`);
const migrations = readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
if (migrations.length === 0) die(`No migrations found in ${migrationsDir}.`);

console.log(bold(`\nTerraMavuno database push`));
console.log(`\n${migrations.length} local migration(s):`);
for (const m of migrations) console.log(`  ${m}`);

// --- local Docker path -----------------------------------------------------------------------
if (local) {
  const dockerUp = spawnSync('docker', ['info'], {stdio: 'ignore', shell: process.platform === 'win32'}).status === 0;
  if (!dockerUp) die('Docker is not running. `--local` uses the Supabase Docker stack.', 'Start Docker Desktop, then: npx supabase start');
  if (!apply) {
    console.log(yellow('\n--local runs `supabase db reset`, which DROPS and rebuilds the local database.'));
    console.log(`Re-run with ${bold('npm run db:push -- --local --yes')} to proceed.`);
    process.exit(0);
  }
  cli(['db', 'reset', '--local']);
  console.log(green('\nLocal database rebuilt: migrations applied and seed loaded.'));
  process.exit(0);
}

// --- remote target ---------------------------------------------------------------------------
const projectRef = process.env.SUPABASE_PROJECT_REF?.trim();
const dbPassword = process.env.SUPABASE_DB_PASSWORD?.trim();
const dbUrl = (process.env.SUPABASE_DB_URL ?? process.env.DATABASE_URL)?.trim();

let target = [];
let described = '';
if (projectRef && dbPassword) {
  target = ['--project-ref', projectRef, '--password', dbPassword];
  described = `Supabase project ${bold(projectRef)}`;
} else if (dbUrl) {
  target = ['--db-url', dbUrl];
  let host = '(unparseable connection string)';
  try {
    const u = new URL(dbUrl);
    host = `${u.hostname}${u.port ? `:${u.port}` : ''}${u.pathname}`;
  } catch { /* keep the placeholder; never print the raw string */ }
  described = `database at ${bold(host)}`;
  if (/[^\x21-\x7e]|[ ]/.test(new URL(dbUrl).password ?? '')) {
    console.log(yellow('\nWarning: the password in your connection string may need percent-encoding.'));
  }
} else {
  die(
    'No target database configured.',
    `Set either of these in .env:

  SUPABASE_PROJECT_REF=<ref from your project URL>
  SUPABASE_DB_PASSWORD=<database password>

or:

  DATABASE_URL=postgresql://postgres.<ref>:<percent-encoded-password>@<host>:5432/postgres

The project ref is the subdomain of your project URL: https://<ref>.supabase.co`
  );
}

console.log(`\nTarget: ${described}`);
if (projectRef && !process.env.SUPABASE_ACCESS_TOKEN?.trim()) {
  console.log(dim('No SUPABASE_ACCESS_TOKEN set; the CLI will use your logged-in session (npx supabase login).'));
}

// --- report ----------------------------------------------------------------------------------
console.log(bold('\n--- Applied vs local ---'));
cli(['migration', 'list', ...target], {allowFailure: true});

console.log(bold('\n--- Dry run ---'));
cli(['db', 'push', '--dry-run', ...target]);

if (!apply) {
  console.log(yellow(`\nNothing was applied. This was a dry run.`));
  console.log(`To apply the migrations${withSeed ? ' and the seed' : ''} to ${described}:\n`);
  console.log(`  ${bold('npm run db:push -- --yes')}\n`);
  console.log(dim('The seed is idempotent (every insert has an ON CONFLICT clause), so re-running is safe.'));
  console.log(dim('Add --no-seed to push migrations only.'));
  process.exit(0);
}

// --- apply -----------------------------------------------------------------------------------
console.log(bold('\n--- Applying ---'));
cli(['db', 'push', ...(withSeed ? ['--include-seed'] : []), '--yes', ...target]);

console.log(bold('\n--- Verifying ---'));
cli(['migration', 'list', ...target], {allowFailure: true});

console.log(green('\nDone.'));
console.log(`Check the API sees it: ${bold('curl http://localhost:8787/health')} should report`);
console.log(`  "store": "supabase (service role)"   once SUPABASE_URL and SUPABASE_SECRET_KEY are set.`);
