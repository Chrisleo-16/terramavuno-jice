-- Idempotent repair for databases that already applied 20260902104652_initial_terramavuno_schema.
--
-- The channel-identity changes to `conversations` (nullable owner_id, channel_identity_hash, the
-- channel value check, the "one identity must be present" constraint) were made by editing the
-- initial migration in place. Supabase records applied migrations by version, so a database that
-- already ran the initial migration will never see those edits — and 20260902160000 would then
-- fail on a missing `channel_identity_hash` column.
--
-- Every statement below is guarded, so this is a no-op on a database created from the current
-- initial migration and a fix-up on one created from the original. It must sort before
-- 20260902160000.

-- A USSD/SMS caller has no auth.users row. DROP NOT NULL is a no-op if already nullable.
alter table public.conversations alter column owner_id drop not null;

-- Salted hash of the MSISDN, computed server-side. Raw phone numbers are never stored.
alter table public.conversations add column if not exists channel_identity_hash text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.conversations'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%channel_identity_hash%'
  ) then
    alter table public.conversations
      add constraint conversations_channel_identity_hash_format
      check (channel_identity_hash ~ '^[0-9a-f]{64}$');
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.conversations'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%ussd%'
  ) then
    alter table public.conversations
      add constraint conversations_channel_allowed
      check (channel in ('web','sms','ussd','ivr','whatsapp'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.conversations'::regclass and conname = 'conversations_identity_present'
  ) then
    alter table public.conversations
      add constraint conversations_identity_present
      check (owner_id is not null or channel_identity_hash is not null);
  end if;
end $$;

create index if not exists conversations_channel_identity_idx
  on public.conversations(channel, channel_identity_hash, updated_at desc);
