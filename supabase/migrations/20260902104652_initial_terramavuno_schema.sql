create schema if not exists extensions;
create extension if not exists postgis schema extensions;
create extension if not exists pgcrypto schema extensions;

create type public.data_classification as enum ('official','research','community','benchmark','simulated');
create type public.confidence_level as enum ('high','moderate','limited','unknown');
create type public.simulation_status as enum ('draft','completed','archived');

create table public.administrative_areas (
  id bigint generated always as identity primary key,
  parent_id bigint references public.administrative_areas(id) on delete restrict,
  level text not null check (level in ('country','county','sub_county','constituency','ward','locality','area')),
  name text not null,
  code text,
  slug text not null,
  boundary extensions.geometry(multipolygon,4326),
  centroid extensions.geography(point,4326),
  source_id text,
  created_at timestamptz not null default now(),
  unique(level,slug)
);
create index administrative_areas_parent_idx on public.administrative_areas(parent_id);
create index administrative_areas_boundary_gix on public.administrative_areas using gist(boundary);
create index administrative_areas_centroid_gix on public.administrative_areas using gist(centroid);

create table public.data_sources (
  id uuid primary key default extensions.gen_random_uuid(), name text not null, publisher text,
  url text, license text, classification public.data_classification not null,
  refresh_frequency text, attribution text not null, terms_checked_at timestamptz,
  is_active boolean not null default true, created_at timestamptz not null default now()
);

create table public.observations (
  id bigint generated always as identity primary key,
  area_id bigint references public.administrative_areas(id) on delete cascade,
  source_id uuid not null references public.data_sources(id) on delete restrict,
  indicator text not null, value numeric not null, unit text not null,
  observed_at timestamptz not null, valid_from timestamptz, valid_to timestamptz,
  confidence public.confidence_level not null default 'unknown', quality_flags text[] not null default '{}',
  source_record_id text, geometry extensions.geometry(geometry,4326), metadata jsonb not null default '{}',
  ingested_at timestamptz not null default now(), unique(source_id,indicator,area_id,observed_at,source_record_id)
);
create index observations_area_indicator_time_idx on public.observations(area_id,indicator,observed_at desc);
create index observations_time_brin on public.observations using brin(observed_at);
create index observations_geometry_gix on public.observations using gist(geometry);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text, organization text, role_name text not null default 'viewer',
  home_area_id bigint references public.administrative_areas(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.budgets (
  id uuid primary key default extensions.gen_random_uuid(), area_id bigint references public.administrative_areas(id),
  owner_id uuid references public.profiles(id), title text not null, fiscal_year text not null,
  currency char(3) not null default 'KES', total_amount numeric(18,2) not null check(total_amount>=0),
  classification public.data_classification not null, source_id uuid references public.data_sources(id), created_at timestamptz not null default now()
);
create index budgets_area_year_idx on public.budgets(area_id,fiscal_year);
create table public.budget_items (
  id uuid primary key default extensions.gen_random_uuid(), budget_id uuid not null references public.budgets(id) on delete cascade,
  parent_id uuid references public.budget_items(id), code text, label text not null, amount numeric(18,2) not null check(amount>=0), metadata jsonb not null default '{}'
);
create index budget_items_budget_idx on public.budget_items(budget_id);

create table public.interventions (
  id uuid primary key default extensions.gen_random_uuid(), slug text unique not null, name text not null,
  category text not null, description text not null, expected_outcomes jsonb not null default '[]', active boolean not null default true
);
create table public.intervention_costs (
  id uuid primary key default extensions.gen_random_uuid(), intervention_id uuid not null references public.interventions(id),
  area_id bigint references public.administrative_areas(id), source_id uuid not null references public.data_sources(id),
  amount numeric(18,2) not null check(amount>0), currency char(3) not null default 'KES', unit text not null,
  effective_from date not null, effective_to date, classification public.data_classification not null,
  assumptions text[] not null default '{}', confidence public.confidence_level not null, created_at timestamptz not null default now()
);
create index intervention_costs_lookup_idx on public.intervention_costs(intervention_id,area_id,effective_from desc);

create table public.simulations (
  id uuid primary key default extensions.gen_random_uuid(), owner_id uuid references public.profiles(id), area_id bigint not null references public.administrative_areas(id),
  budget_amount numeric(18,2) not null check(budget_amount>0), currency char(3) not null default 'KES', objective text not null,
  horizon_years smallint not null check(horizon_years between 1 and 30), status public.simulation_status not null default 'draft',
  assumptions jsonb not null default '[]', model_version text not null, is_official boolean not null default false,
  created_at timestamptz not null default now(), completed_at timestamptz
);
create index simulations_owner_created_idx on public.simulations(owner_id,created_at desc);
create table public.simulation_options (
  id uuid primary key default extensions.gen_random_uuid(), simulation_id uuid not null references public.simulations(id) on delete cascade,
  intervention_id uuid references public.interventions(id), rank smallint, allocated_amount numeric(18,2) not null,
  beneficiaries_estimate integer, implementation_months smallint, suitability_score numeric(5,2), impact_score numeric(5,2),
  evidence_strength public.confidence_level not null, risks jsonb not null default '[]', unknowns jsonb not null default '[]', calculation jsonb not null default '{}'
);
create index simulation_options_simulation_idx on public.simulation_options(simulation_id,rank);

create table public.programmes (
  id uuid primary key default extensions.gen_random_uuid(), area_id bigint references public.administrative_areas(id), source_id uuid references public.data_sources(id),
  name text not null, organization text, status text, start_date date, end_date date, budget_amount numeric(18,2), currency char(3) default 'KES',
  beneficiaries integer, geometry extensions.geometry(geometry,4326), metadata jsonb not null default '{}'
);
create index programmes_area_status_idx on public.programmes(area_id,status);
create table public.projects (
  id uuid primary key default extensions.gen_random_uuid(), programme_id uuid references public.programmes(id) on delete set null,
  area_id bigint references public.administrative_areas(id), name text not null, status text, progress_percent numeric(5,2) check(progress_percent between 0 and 100),
  start_date date, end_date date, geometry extensions.geometry(geometry,4326), metadata jsonb not null default '{}'
);
create table public.infrastructure_assets (
  id uuid primary key default extensions.gen_random_uuid(), area_id bigint references public.administrative_areas(id), source_id uuid references public.data_sources(id),
  name text not null, asset_type text not null, status text, capacity numeric, capacity_unit text,
  commissioned_at date, location extensions.geography(point,4326), geometry extensions.geometry(geometry,4326), metadata jsonb not null default '{}'
);
create index infrastructure_assets_location_gix on public.infrastructure_assets using gist(location);

create table public.documents (
  id uuid primary key default extensions.gen_random_uuid(), owner_id uuid references public.profiles(id), source_id uuid references public.data_sources(id),
  title text not null, document_type text, storage_path text, external_url text, published_at timestamptz,
  checksum text, metadata jsonb not null default '{}', created_at timestamptz not null default now()
);
create table public.reports (
  id uuid primary key default extensions.gen_random_uuid(), owner_id uuid references public.profiles(id), simulation_id uuid references public.simulations(id),
  title text not null, format text not null, storage_path text, content jsonb not null default '{}', generated_at timestamptz not null default now()
);
create table public.conversations (
  id uuid primary key default extensions.gen_random_uuid(), owner_id uuid not null references public.profiles(id), channel text not null,
  external_thread_id text, state jsonb not null default '{}', created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index conversations_owner_idx on public.conversations(owner_id,updated_at desc);
create table public.sessions (
  id uuid primary key default extensions.gen_random_uuid(), conversation_id uuid not null references public.conversations(id) on delete cascade,
  channel_session_id text, started_at timestamptz not null default now(), ended_at timestamptz, context jsonb not null default '{}'
);
create table public.evidence_records (
  id uuid primary key default extensions.gen_random_uuid(), source_id uuid not null references public.data_sources(id), area_id bigint references public.administrative_areas(id),
  claim text not null, value jsonb, valid_from timestamptz, valid_to timestamptz, confidence public.confidence_level not null,
  verification_status text not null default 'unverified', document_id uuid references public.documents(id), locator text, created_at timestamptz not null default now()
);
create index evidence_records_area_idx on public.evidence_records(area_id,created_at desc);
create table public.provenance_events (
  id bigint generated always as identity primary key, entity_table text not null, entity_id text not null,
  action text not null, source_id uuid references public.data_sources(id), actor_id uuid references public.profiles(id),
  input_hash text, output_hash text, transformation text, metadata jsonb not null default '{}', occurred_at timestamptz not null default now()
);
create index provenance_entity_idx on public.provenance_events(entity_table,entity_id,occurred_at desc);
create table public.audit_events (
  id bigint generated always as identity primary key, actor_id uuid references public.profiles(id), action text not null,
  entity_table text not null, entity_id text, request_id text, ip_hash text, changes jsonb, occurred_at timestamptz not null default now()
);
create index audit_events_time_idx on public.audit_events(occurred_at desc);

create view public.latest_observations with (security_invoker=true) as
select distinct on (area_id,indicator) * from public.observations order by area_id,indicator,observed_at desc;

do $$ declare t text; begin foreach t in array array['administrative_areas','data_sources','observations','profiles','budgets','budget_items','interventions','intervention_costs','simulations','simulation_options','programmes','projects','infrastructure_assets','documents','reports','conversations','sessions','evidence_records','provenance_events','audit_events'] loop execute format('alter table public.%I enable row level security',t); end loop; end $$;

revoke all on all tables in schema public from anon, authenticated;
grant select on public.administrative_areas, public.data_sources, public.observations, public.interventions, public.intervention_costs, public.programmes, public.projects, public.infrastructure_assets, public.evidence_records, public.latest_observations to anon, authenticated;
grant select,insert,update,delete on public.profiles, public.budgets, public.budget_items, public.simulations, public.simulation_options, public.documents, public.reports, public.conversations, public.sessions to authenticated;

create policy "public read administrative areas" on public.administrative_areas for select to anon, authenticated using (true);
create policy "public read sources" on public.data_sources for select to anon, authenticated using (is_active);
create policy "public read observations" on public.observations for select to anon, authenticated using (true);
create policy "public read interventions" on public.interventions for select to anon, authenticated using (active);
create policy "public read intervention costs" on public.intervention_costs for select to anon, authenticated using (classification in ('official','research','benchmark'));
create policy "public read programmes" on public.programmes for select to anon, authenticated using (true);
create policy "public read projects" on public.projects for select to anon, authenticated using (true);
create policy "public read infrastructure" on public.infrastructure_assets for select to anon, authenticated using (true);
create policy "public read verified evidence" on public.evidence_records for select to anon, authenticated using (verification_status='verified');

create policy "profile own read" on public.profiles for select to authenticated using ((select auth.uid())=id);
create policy "profile own insert" on public.profiles for insert to authenticated with check ((select auth.uid())=id);
create policy "profile own update" on public.profiles for update to authenticated using ((select auth.uid())=id) with check ((select auth.uid())=id);

do $$ declare t text; begin foreach t in array array['budgets','simulations','documents','reports','conversations'] loop
  execute format('create policy %I on public.%I for select to authenticated using ((select auth.uid())=owner_id)',t||'_own_select',t);
  execute format('create policy %I on public.%I for insert to authenticated with check ((select auth.uid())=owner_id)',t||'_own_insert',t);
  execute format('create policy %I on public.%I for update to authenticated using ((select auth.uid())=owner_id) with check ((select auth.uid())=owner_id)',t||'_own_update',t);
  execute format('create policy %I on public.%I for delete to authenticated using ((select auth.uid())=owner_id)',t||'_own_delete',t);
end loop; end $$;

create policy "own budget items" on public.budget_items for all to authenticated using (exists(select 1 from public.budgets b where b.id=budget_id and b.owner_id=(select auth.uid()))) with check (exists(select 1 from public.budgets b where b.id=budget_id and b.owner_id=(select auth.uid())));
create policy "own simulation options" on public.simulation_options for all to authenticated using (exists(select 1 from public.simulations s where s.id=simulation_id and s.owner_id=(select auth.uid()))) with check (exists(select 1 from public.simulations s where s.id=simulation_id and s.owner_id=(select auth.uid())));
create policy "own sessions" on public.sessions for all to authenticated using (exists(select 1 from public.conversations c where c.id=conversation_id and c.owner_id=(select auth.uid()))) with check (exists(select 1 from public.conversations c where c.id=conversation_id and c.owner_id=(select auth.uid())));
