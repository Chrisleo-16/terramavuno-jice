# Kilimo, Nitapata? — Supabase migration + seed notes

What this adds on top of the initial 21-table TerraMavuno schema
(`migrations/20260902104652_initial_terramavuno_schema.sql`):

- `migrations/20260903000000_kilimo_subsidy.sql`
  - `public.programmes.slug` (unique, nullable) — stable lookup for `ken-fert-subsidy-2026`.
  - `public.farmer_tokens` — synthetic farmer tokens K-001…K-004. **No PII columns by design.**
  - `public.subsidy_prices` — gazetted price schedule (KES 2,500 subsidized / 6,500 market per 50 kg bag) with validity window.
  - RLS enabled on both new tables; `anon`/`authenticated` get SELECT only; all writes go through the service role.
- `seed.sql` — the `-- === KILIMO, NITAPATA? seed ===` section (idempotent; fixed UUIDs, `on conflict` upserts, `not exists` guards). It seeds:
  - 5 `data_sources` (MoALD circular, Kenya Gazette notice, NCPB depot list, geoBoundaries KEN, TerraMavuno synthetic generator),
  - Murang'a county centroid + Kandara constituency (code 109) + its 6 wards (codes 0539–0544) with centroids,
  - the `ken-fert-subsidy-2026` programme with the full `ProgrammeRules` shape in `metadata`,
  - 1 `subsidy_prices` row, 4 depot `infrastructure_assets` (1 official NCPB + 3 SIMULATED agro-dealers; Kabati Agrovet has `stock_status: unknown` — the sijui depot),
  - 4 `farmer_tokens` (K-001 confirmed, K-002 missing id_linked, K-003 over acreage cap, K-004 the sijui case),
  - 5 `evidence_records` headline claims and 7 `provenance_events` (`action = 'seeded'`).

## Apply to the hosted project (`gxecynujvqmubkezqpgt`)

From the repo root:

```powershell
npx supabase link --project-ref gxecynujvqmubkezqpgt
npx supabase db push                 # applies pending migrations only
npx supabase db push --include-seed  # ALSO runs seed.sql against the remote
```

`db push` alone creates the tables but leaves them empty — the seed only runs when
you pass `--include-seed` (remote) or run `db reset` (local). The linking step will
prompt for the database password; the CLI may also use `SUPABASE_ACCESS_TOKEN`
from your shell session — see the token warning below.

## Apply locally (Docker required)

```powershell
npx supabase start
npx supabase db reset   # replays ALL migrations in order, then runs seed.sql
```

## What to expect after seeding

- `select token_code, state from farmer_tokens order by token_code;` → K-001 registered, K-002 missing_requirement, K-003 ineligible, K-004 registered (assigned to the unknown-stock Kabati Agrovet — the engine turns that into `indicated_by_published_rules` + the sijui message).
- `select slug, metadata->'allocationFormula' from programmes where slug='ken-fert-subsidy-2026';` → `{"bagsPerAcre": 2, "maxBags": 10}`.
- `select subsidized_price_kes, market_price_kes from subsidy_prices;` → 2500 / 6500.
- Anonymous (anon key) reads work on `farmer_tokens`, `subsidy_prices`, `administrative_areas`, `programmes`, `infrastructure_assets`; `evidence_records` only exposes `verification_status = 'verified'` rows to anon — the simulated unknown-stock claim (id `…0405`) is deliberately `unverified` and visible only to the service role.
- Re-running the seed is safe: rows upsert in place and provenance events are not duplicated.

## Rollback

Migrations here have no down files. To undo on the remote, run these in the SQL
editor (service role):

```sql
drop table if exists public.farmer_tokens;
drop table if exists public.subsidy_prices;
alter table public.programmes drop constraint if exists programmes_slug_key;
alter table public.programmes drop column if exists slug;
delete from public.provenance_events where entity_id like 'kilimo:%';
delete from public.evidence_records where id::text like '00000000-0000-0000-0000-0000000004%';
delete from public.infrastructure_assets where id::text like '00000000-0000-0000-0000-0000000003%';
delete from public.programmes where id = '00000000-0000-0000-0000-000000000201';
delete from public.data_sources where id::text in ('00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000102','00000000-0000-0000-0000-000000000103','00000000-0000-0000-0000-000000000104','00000000-0000-0000-0000-000000000105');
delete from public.administrative_areas where level in ('ward','constituency') and slug in ('kandara','ng-araria','muruka','kagundu-ini','gaichanjiru','ithiru','ruchu');
```

Then remove the migration record so the CLI stays in sync:
`delete from supabase_migrations.schema_migrations where version = '20260903000000';`
(Locally, just delete the migration file and `npx supabase db reset`.)

## Token warning

The Supabase **personal access token** (used by `supabase login` / the MCP server)
belongs in your local MCP auth or CLI keychain ONLY. Never put it in `.env`,
`.env.example`, or anything committed to git. The only Supabase secrets the app
uses are `SUPABASE_SECRET_KEY` (server-only, in the untracked root `.env`) and the
publishable anon key (client-safe). `farmer_tokens` contains no PII, so even a
leaked anon key exposes nothing personal — keep it that way: never add name,
phone, or national-ID columns.
