# Omnichannel

Clean-room channel adapter design inspired by AGRION's public architecture description: one
conversation state with per-channel formatting for web, SMS, USSD, IVR and WhatsApp. AGRION code
is not copied because the cloned repository contains no license grant.

## Why this is not a delivery afterthought

The browser client needs WebGL, bandwidth and a laptop, so on its own the product reaches
officials rather than the farmers a county allocation is spent on. USSD/SMS is the only channel
that does not select for income, data plan, smartphone, grid power or English literacy, which
makes it two things at once:

- **The reach denominator.** `extension-support` is benchmarked at KES 10,000 per farmer reached
  with the assumption "digital and field delivery combined" (`packages/shared/src/simulator.ts`).
  It is the cheapest unit cost by 2.4x, so it dominates the beneficiary count in every ranking and
  is 25% of the winning blended portfolio. The channel is already inside the headline number.
- **The ground-truth sensor.** Every other observation in the model is remote sensing or synthetic
  benchmark. Inbound field reports are the only source of `community` classification, and the only
  mechanism that can move an evidence claim's confidence in either direction.

It is therefore step 7 of the primary journey in `docs/PRD.md`, not a later phase.

## What exists in P0

| Piece | Location |
|---|---|
| USSD menu (pure, stateless) | `packages/shared/src/ussd.ts` |
| SMS bodies, GSM-7 handling, segmentation, inbound parsing | `packages/shared/src/sms.ts` |
| County resolution for keypad/SMS input | `packages/shared/src/counties.ts` (`matchCounty`) |
| Africa's Talking client | `services/api/src/africastalking.ts` |
| Webhook routes | `services/api/src/channels.ts` |
| Persistence boundary | `services/api/src/channel-store.ts` (`ChannelStore`, in-memory fallback) |
| Supabase persistence | `services/api/src/supabase-channel-store.ts` |
| Channel migration | `supabase/migrations/20260902160000_farmer_channel_persistence.sql` |
| Report normalisation + identity hashing | `services/api/src/field-reports.ts` |
| Inbound tool contract | `record_field_report` in `packages/shared/src/tool-schemas.ts` |
| Outbound delivery | `send_report` with `email`/`sms`/`ussd`/`whatsapp` |
| Ingestion endpoint | `POST /api/field-reports` |
| Conversation storage | `conversations` / `sessions` in the initial migration |
| Community source row | `data_sources` id `…0003` in `supabase/seed.sql` |
| Callback URL helper | `npm run channels:urls` |
| Tests | `packages/shared/src/{ussd,sms}.test.ts`, `services/api/src/{channels,supabase-channel-store}.test.ts` |

## USSD menu

```text
*384*XXXXX#
  1. Rain and drought        -> enter county -> END outlook (demo benchmark, labelled)
  2. Report from my farm     -> 1 Rains failed or late
                                2 Crop loss
                                3 Water point not working
                                4 Seed or input not delivered
                             -> enter county -> END ack + community evidence record
  3. Advisory by SMS         -> enter county -> END + outbound SMS
```

AT replays the whole keypress path in `text` (`""`, `"2"`, `"2*1"`, `"2*1*makueni"`), so the menu
is a pure function and needs no session store. The county prompt reads the last input, so a
mistyped county re-prompts without losing the branch.

## SMS grammar

| Inbound | Effect |
|---|---|
| `Makueni` (bare county name) | outlook advisory |
| `OUTLOOK <county>` / `RAIN <county>` | outlook advisory |
| `REPORT <county> <what you see>` | community evidence record + acknowledgement |
| `STOP` / `UNSUBSCRIBE` / `QUIT` / `CANCEL` | opt out; the channel then stays silent |
| `START` | opt back in |
| anything else | help text |

Two-word counties are handled (`REPORT Homa Bay water point down` does not put "Bay" in the
observation). Every advisory is asserted to fit one billed SMS segment across all 47 counties —
a template that spills into a second segment doubles the cost of the reach figure the simulator
advertises.

## Identity and privacy

A USSD or SMS caller has no `auth.users` row, so `conversations.owner_id` is nullable and those
rows are keyed by `channel_identity_hash`: a salted sha256 of the MSISDN, computed server-side
from `FIELD_REPORT_SALT`. A table check requires one identity or the other. Because the ownership
policies compare `auth.uid()` to `owner_id`, channel-owned conversations are invisible to `anon`
and `authenticated` and must be reached through the service role.

The MSISDN AT sends on each callback exists in memory only for the length of that request — long
enough to address the reply — and is never stored, logged or echoed. The direct HTTP endpoint
rejects a `session_ref` shaped like a phone number rather than hashing it silently. Delivery-report
logging prints the message id and status but not the number.

## Webhook authentication

Africa's Talking does not sign its callbacks, so there is nothing to verify cryptographically.
What the API can do, and does: a secret path segment (`CHANNEL_WEBHOOK_TOKEN`) compared in constant
time, `503` rather than open access when it is unset, and `404` on mismatch so the route's
existence is not confirmed. Add an IP allowlist for AT's source ranges at the edge; confirm the
current list in your dashboard because it changes. Treat a leaked callback URL as a leaked
credential and rotate the token.

## Persistence

`ChannelStore` is selected at startup: `SupabaseChannelStore` when `SUPABASE_URL` and
`SUPABASE_SECRET_KEY` are set, `InMemoryChannelStore` otherwise. `GET /health` reports which one is
live. Both implement the same idempotency behaviour so a provider retry behaves identically either
way; the in-memory one always answers `persisted: false`.

An accepted report writes `conversations` (upsert on `(channel, channel_identity_hash)`, null
`owner_id`), `evidence_records` (`claim` = the observation, `area_id` resolved from the county,
`verification_status = 'unverified'`) and `provenance_events` (input/output hashes, a readable
`transformation`, and the conversation link). Service role is required — channel-owned conversations
are invisible to every other role under RLS.

Three points that are easy to get wrong:

- The **conversation link is only in `provenance_events`**. `anon` can read verified evidence, so
  exposing `conversation_id` there would let an anonymous reader group verified claims back to one
  reporter. `20260902160000_farmer_channel_persistence.sql` revokes table-level `select` on
  `evidence_records` and re-grants column by column without it.
- **Idempotency is a unique index** on `(source_id, source_record_id)`, not a code check. AT
  re-posts inbound SMS on non-2xx. A recognised retry also suppresses the duplicate acknowledgement
  SMS, because otherwise a retry storm doubles the reports *and* bills for every ack.
- **Opt-out is keyed to the identity hash**, in `channel_preferences`, so `STOP` over SMS silences
  the USSD advisory path too. RLS on, no policies, no grants: service role only.

## Not yet built

- **Verification workflow.** Nothing yet promotes a reviewed community report to verified evidence,
  which is what would let field truth actually move a claim's confidence. Until it exists, inbound
  reports are stored and invisible to `anon` (the public policy requires
  `verification_status = 'verified'`).
- **Rate limiting per identity hash.** Nothing stops one number filing thousands of reports and
  skewing the community evidence set.
- **Delivery-report persistence.** Callbacks are acknowledged and logged, not stored against the
  sent message.
- **IVR and WhatsApp adapters**, and per-channel formatters beyond USSD/SMS.
- **Provider endpoint confirmation.** The SMS client posts form-encoded to
  `/version1/messaging`; AT also documents a newer JSON bulk route. Verify against your dashboard
  before production.
