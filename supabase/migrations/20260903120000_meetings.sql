-- ---------------------------------------------------------------------------
-- Nielekeze by TerraMavuno — farmer-facing meetings (online and physical)
--
-- A meeting is an ANNOUNCEMENT, never an input to the eligibility engine. It
-- is kept in its own tables precisely so that it cannot become one: nothing
-- here is joined into a decision trace.
--
-- Provenance mirrors the evidence model. `authority` says who called the
-- meeting, and a `community` row must be rendered to farmers as a community
-- notice — the API stamps the citation itself so a caller cannot mint an
-- official-looking announcement.
--
-- PRIVACY: no phone numbers. An RSVP is keyed by the same opaque farmer token
-- (K-001) used everywhere else. Recipient numbers are supplied per-request for
-- delivery and are never written down.
-- ---------------------------------------------------------------------------

create table if not exists public.meetings (
  id               text primary key,
  title            text        not null check (length(btrim(title)) between 3 and 120),
  agenda           text,
  mode             text        not null check (mode in ('physical', 'online', 'hybrid')),
  authority        text        not null check (authority in ('official', 'community')),
  status           text        not null default 'scheduled'
                                 check (status in ('scheduled', 'cancelled', 'completed')),
  starts_at        timestamptz not null,
  duration_minutes integer     not null default 60 check (duration_minutes between 5 and 600),
  ward_code        text,
  ward_name        text,
  venue            text,
  lat              double precision check (lat between -90 and 90),
  lon              double precision check (lon between -180 and 180),
  join_url         text,
  organiser        text        not null,
  citation         text        not null,
  created_at       timestamptz not null default now(),

  -- A farmer must always be able to work out how to attend.
  constraint meetings_physical_needs_venue
    check (mode = 'online' or venue is not null),
  constraint meetings_online_needs_link
    check (mode = 'physical' or join_url is not null)
);

comment on table public.meetings is
  'Farmer-facing meetings, online or physical. ANNOUNCEMENTS ONLY - never an input to the eligibility engine. authority=community rows are self-organised and must be surfaced to farmers as community notices, not official summonses. Contains no PII.';

comment on column public.meetings.authority is
  'official = called by a programme/government office; community = self-organised. Drives the notice wording on every channel.';

comment on column public.meetings.citation is
  'Provenance sentence shown wherever the meeting appears. Written by the API, never accepted from the client.';

create index if not exists meetings_starts_at_idx on public.meetings (starts_at);
create index if not exists meetings_ward_idx on public.meetings (ward_code) where ward_code is not null;
-- The hot query is "what is coming up for this ward".
create index if not exists meetings_upcoming_idx
  on public.meetings (starts_at) where status = 'scheduled';

create table if not exists public.meeting_rsvps (
  meeting_id   text        not null references public.meetings (id) on delete cascade,
  -- Opaque token (K-001). NEVER a name, phone number or national ID.
  farmer_token text        not null check (farmer_token ~ '^K-[0-9]{3,}$'),
  response     text        not null check (response in ('yes', 'no', 'maybe')),
  responded_at timestamptz not null default now(),
  -- One standing answer per farmer per meeting; a farmer may change their mind
  -- and the upsert overwrites rather than accumulating contradictory rows.
  primary key (meeting_id, farmer_token)
);

comment on table public.meeting_rsvps is
  'Attendance answers, keyed by opaque farmer token. CONTAINS NO PII: no names, phone numbers or national ID values. Last answer wins.';

create index if not exists meeting_rsvps_meeting_idx on public.meeting_rsvps (meeting_id);

-- RLS: these tables are written and read through the service role only. A USSD
-- or SMS caller has no auth.users row, so leaving RLS enabled with no
-- permissive policy makes the tables invisible to anon/authenticated by
-- design, exactly as the channel tables do.
alter table public.meetings       enable row level security;
alter table public.meeting_rsvps  enable row level security;
