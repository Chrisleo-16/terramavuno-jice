-- ============================================================================
-- Nielekeze by TerraMavuno — fertilizer-subsidy navigator persistence
-- ============================================================================
-- Adds ONLY what the initial 21-table TerraMavuno schema
-- (20260902104652_initial_terramavuno_schema.sql) lacks:
--   1. public.programmes.slug        — stable text identifier for programme lookup
--   2. public.farmer_tokens          — synthetic farmer tokens (NO PII, ever)
--   3. public.subsidy_prices         — gazetted price schedule + allocation caps
-- Everything else in the Kilimo journey reuses existing tables:
--   programme rules      -> public.programmes.metadata (jsonb ProgrammeRules)
--   depots               -> public.infrastructure_assets (PostGIS point + metadata)
--   sources              -> public.data_sources
--   claims               -> public.evidence_records
--   audit trail          -> public.provenance_events
-- Conventions match the initial migration exactly: enums public.data_classification
-- and public.confidence_level, extensions.gen_random_uuid(), bigint identity PKs on
-- administrative_areas, uuid PKs elsewhere, RLS with public read-only SELECT policies
-- and all writes reserved to the service role (no insert/update/delete grants or
-- policies for anon/authenticated).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. programmes.slug — the engine and API address the programme as
--    'ken-fert-subsidy-2026'; programmes.id is uuid, so a stable slug is added.
-- ----------------------------------------------------------------------------
alter table public.programmes add column slug text;
alter table public.programmes add constraint programmes_slug_key unique (slug);
comment on column public.programmes.slug is
  'Stable text identifier used by the eligibility engine and API (e.g. ken-fert-subsidy-2026). Unique when present; nullable for legacy rows.';

-- ----------------------------------------------------------------------------
-- 2. farmer_tokens — synthetic demo farmers, one row per journey state.
--    NO PII COLUMNS BY DESIGN: no names, no phone numbers, no national ID
--    values. Registration/ID linkage are represented only as booleans (or the
--    string 'unknown') inside attributes. Token codes are synthetic (K-001…).
-- ----------------------------------------------------------------------------
create table public.farmer_tokens (
  id uuid primary key default extensions.gen_random_uuid(),
  token_code text unique not null,
  ward_area_id bigint references public.administrative_areas(id) on delete restrict,
  state text not null check (state in ('registered','missing_requirement','ineligible','unknown')),
  assigned_depot_id uuid references public.infrastructure_assets(id) on delete set null,
  attributes jsonb not null default '{}'::jsonb,
  classification public.data_classification not null default 'simulated',
  created_at timestamptz not null default now()
);

comment on table public.farmer_tokens is
  'Synthetic farmer tokens for the Nielekeze by TerraMavuno demo. CONTAINS NO PII: no names, phone numbers or national ID values — only opaque token codes (K-001…) and boolean/unknown flags. classification defaults to simulated; every consumer must surface that label. The deterministic engine (not Claude) evaluates these rows against programmes.metadata rules.';
comment on column public.farmer_tokens.token_code is
  'Opaque synthetic token (e.g. K-001). The only identifier a farmer presents; never maps to a real person.';
comment on column public.farmer_tokens.ward_area_id is
  'Ward the token is registered in (administrative_areas.level = ward). Drives the ward_participating criterion and map centroid placement.';
comment on column public.farmer_tokens.state is
  'Journey state the token demonstrates: registered | missing_requirement | ineligible | unknown (unknown = register status itself unverifiable, engine returns cannot_determine).';
comment on column public.farmer_tokens.assigned_depot_id is
  'infrastructure_assets row (depot) the token would redeem at. When the depot metadata stock_status is unknown, the engine returns indicated_by_published_rules with the sijui message.';
comment on column public.farmer_tokens.attributes is
  'Engine FarmerToken attributes: { inFarmerRegister: boolean|''unknown'', nationalIdLinked: boolean, acreage: number, crop: text, priorRedemptions: number }. Evidence semantics: reported/simulated, freshness = created_at.';
comment on column public.farmer_tokens.classification is
  'Truth-model authority axis for the row itself. Demo tokens are simulated and must always be labelled as such.';
comment on column public.farmer_tokens.created_at is
  'Freshness (checkedAt) timestamp for the token attributes.';

-- token_code is indexed by its UNIQUE constraint (farmer_tokens_token_code_key).
create index farmer_tokens_ward_idx on public.farmer_tokens(ward_area_id);
create index farmer_tokens_depot_idx on public.farmer_tokens(assigned_depot_id);

-- ----------------------------------------------------------------------------
-- 3. subsidy_prices — gazetted price schedule with validity window.
-- ----------------------------------------------------------------------------
create table public.subsidy_prices (
  id uuid primary key default extensions.gen_random_uuid(),
  programme_id uuid not null references public.programmes(id) on delete cascade,
  input_type text not null,
  subsidized_price_kes numeric not null check (subsidized_price_kes >= 0),
  market_price_kes numeric check (market_price_kes >= 0),
  bag_weight_kg numeric not null default 50,
  bags_per_acre numeric,
  allocation_bags_max integer,
  valid_from date,
  valid_to date,
  source_id uuid references public.data_sources(id) on delete restrict,
  classification public.data_classification not null default 'official',
  created_at timestamptz not null default now(),
  constraint subsidy_prices_validity_chk check (valid_from is null or valid_to is null or valid_to >= valid_from)
);

comment on table public.subsidy_prices is
  'Price schedule for a subsidy programme. Evidence semantics: authority comes from classification + source_id (e.g. Kenya Gazette price notice = official/direct), freshness from the valid_from..valid_to window — outside it the engine must mark the price stale, never guess a new one.';
comment on column public.subsidy_prices.programme_id is 'Programme this schedule belongs to (public.programmes).';
comment on column public.subsidy_prices.input_type is 'Input the price applies to (e.g. planting_fertilizer). One row per input type per validity window.';
comment on column public.subsidy_prices.subsidized_price_kes is 'Farmer-payable price in KES per bag under the subsidy (official/direct when sourced to a gazette notice).';
comment on column public.subsidy_prices.market_price_kes is 'Reference open-market price in KES per bag, used for the savings comparison (reported; cite its source).';
comment on column public.subsidy_prices.bag_weight_kg is 'Bag size the prices refer to (default 50 kg).';
comment on column public.subsidy_prices.bags_per_acre is 'Allocation formula input: bags allocated per registered acre (calculated derivation when applied).';
comment on column public.subsidy_prices.allocation_bags_max is 'Hard cap on bags per farmer per season.';
comment on column public.subsidy_prices.valid_from is 'First day the schedule is in force (freshness axis: before this = not yet effective).';
comment on column public.subsidy_prices.valid_to is 'Last day the schedule is in force (freshness axis: after this = stale, engine must say so).';
comment on column public.subsidy_prices.source_id is 'data_sources row backing the schedule (e.g. Kenya Gazette price notice).';
comment on column public.subsidy_prices.classification is 'Authority axis of the schedule itself: official for gazetted prices, simulated for demo fixtures.';
comment on column public.subsidy_prices.created_at is 'Row ingestion timestamp (checkedAt for provenance).';

create index subsidy_prices_programme_idx on public.subsidy_prices(programme_id);
create index subsidy_prices_validity_idx on public.subsidy_prices(valid_from, valid_to);

-- ----------------------------------------------------------------------------
-- 4. RLS + grants — same posture as the initial migration:
--    anon/authenticated may SELECT (rows are synthetic/official reference data);
--    all writes go through the service role, which bypasses RLS. No write
--    grants or write policies are created for anon/authenticated.
-- ----------------------------------------------------------------------------
alter table public.farmer_tokens enable row level security;
alter table public.subsidy_prices enable row level security;

revoke all on public.farmer_tokens, public.subsidy_prices from anon, authenticated;
grant select on public.farmer_tokens, public.subsidy_prices to anon, authenticated;

create policy "public read farmer tokens" on public.farmer_tokens for select to anon, authenticated using (true);
create policy "public read subsidy prices" on public.subsidy_prices for select to anon, authenticated using (true);
