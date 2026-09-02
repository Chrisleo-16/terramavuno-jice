-- Farmer-channel persistence.
--
-- Additive to the initial schema. Adds what the USSD/SMS return path needs in order to write
-- durable records instead of holding them in process memory:
--   1. atomic upsert targets for conversations and sessions (concurrent USSD requests in one
--      session would otherwise create duplicate conversation rows),
--   2. an idempotency key on evidence_records, because Africa's Talking retries inbound SMS and a
--      retry must not become a second field report,
--   3. cross-channel opt-out state, keyed to the identity hash rather than to a conversation, so
--      STOP sent over SMS also silences the USSD advisory path,
--   4. a channel column on evidence_records so a community claim can be traced to the channel it
--      arrived on without joining through provenance.
--
-- Channel rows are written by the API using the service role, which bypasses RLS. No new public
-- grant is issued, and no raw phone number is stored anywhere in this migration.

-- 1. Atomic upsert targets ---------------------------------------------------------------------
-- Not partial, on purpose: `on conflict` cannot target a partial index without repeating its
-- predicate, which the client cannot express. Under the default NULLS DISTINCT these indexes
-- leave account-owned conversations (channel_identity_hash null) unconstrained anyway, which is
-- the behaviour we want.
create unique index conversations_channel_identity_key
  on public.conversations(channel, channel_identity_hash);

create unique index sessions_conversation_channel_session_key
  on public.sessions(conversation_id, channel_session_id);

-- 2. Idempotency + channel provenance on evidence records --------------------------------------
alter table public.evidence_records
  add column source_record_id text,
  add column channel text check (channel in ('web','sms','ussd','ivr','whatsapp')),
  add column conversation_id uuid references public.conversations(id) on delete set null;

-- Provider message id (AT's `id` for inbound SMS, sessionId + input path for USSD) deduplicates
-- retries. NULLS DISTINCT keeps rows without a provider id unconstrained.
create unique index evidence_records_source_record_key
  on public.evidence_records(source_id, source_record_id);

create index evidence_records_conversation_idx
  on public.evidence_records(conversation_id, created_at desc);

-- `conversation_id` is a re-identification vector: with the public read policy on verified rows,
-- anon could group several verified claims back to one reporter. Keep it out of the public path by
-- narrowing the existing policy to the columns anon actually needs.
revoke select on public.evidence_records from anon, authenticated;
grant select (id, source_id, area_id, claim, value, valid_from, valid_to, confidence,
              verification_status, document_id, locator, channel, created_at)
  on public.evidence_records to anon, authenticated;

-- 3. Cross-channel opt-out ---------------------------------------------------------------------
create table public.channel_preferences (
  identity_hash text primary key check (identity_hash ~ '^[0-9a-f]{64}$'),
  opted_out boolean not null default false,
  opted_out_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.channel_preferences enable row level security;
-- No grant to anon/authenticated: consent state is reachable only through the service role.
-- Deliberately no policies either; RLS with zero policies denies everything but the service role.

comment on table public.channel_preferences is
  'Per-identity messaging consent for the farmer channel, keyed by the salted MSISDN hash so an opt-out applies across USSD, SMS, IVR and WhatsApp. Service-role only.';
comment on column public.evidence_records.source_record_id is
  'Provider record id used for idempotency; inbound SMS retries from Africa''s Talking must not create duplicate reports.';
