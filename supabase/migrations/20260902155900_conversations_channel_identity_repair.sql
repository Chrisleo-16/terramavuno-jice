-- Repair migration: bring `public.conversations` up to the shape the farmer
-- channel expects.
--
-- WHY THIS EXISTS
-- The farmer-channel work edited 20260902104652_initial_terramavuno_schema.sql
-- in place to add `channel_identity_hash`, relax `owner_id` and add a channel
-- CHECK. That migration had already been applied to the hosted project, so the
-- edits could never run there and the API failed at runtime with
--   "Could not find the 'channel_identity_hash' column of 'conversations'".
-- Editing an applied migration is a no-op against a live database; the delta
-- has to ship as its own migration. This is that delta.
--
-- Idempotent throughout, so it is safe on a fresh `db reset` (where the initial
-- migration already produced the target shape) and on the hosted project.

-- 1. A channel-owned conversation has no account behind it.
alter table public.conversations
  alter column owner_id drop not null;

-- 2. Constrain the channel vocabulary.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.conversations'::regclass
      and conname = 'conversations_channel_check'
  ) then
    alter table public.conversations
      add constraint conversations_channel_check
      check (channel in ('web','sms','ussd','ivr','whatsapp'));
  end if;
end $$;

-- 3. The salted sha256 of a provider session id. Never a raw phone number:
--    the regex enforces a 64-char lowercase hex digest.
alter table public.conversations
  add column if not exists channel_identity_hash text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.conversations'::regclass
      and conname = 'conversations_channel_identity_hash_check'
  ) then
    alter table public.conversations
      add constraint conversations_channel_identity_hash_check
      check (channel_identity_hash is null or channel_identity_hash ~ '^[0-9a-f]{64}$');
  end if;
end $$;

-- 4. Every conversation is reachable by exactly one of the two identities.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.conversations'::regclass
      and conname = 'conversations_identity_present'
  ) then
    alter table public.conversations
      add constraint conversations_identity_present
      check (owner_id is not null or channel_identity_hash is not null);
  end if;
end $$;

-- 5. Lookup path for "the open conversation for this hashed caller".
create index if not exists conversations_channel_identity_idx
  on public.conversations (channel, channel_identity_hash, updated_at desc);

comment on column public.conversations.channel_identity_hash is
  'Salted sha256 of the provider session id for an account-less channel conversation (USSD/SMS). Never a raw MSISDN — an unsalted hash of a Kenyan number is brute-forceable. Withheld from public reads.';
