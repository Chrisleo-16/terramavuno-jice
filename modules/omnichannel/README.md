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
| Inbound tool contract | `record_field_report` in `packages/shared/src/tool-schemas.ts` |
| Outbound delivery | `send_report` with `email`/`sms`/`ussd`/`whatsapp` |
| Channel list | `farmerChannels` export, echoed by `GET /api/tools` |
| Ingestion endpoint | `POST /api/field-reports` in `services/api/src/app.ts` |
| Conversation storage | `conversations` / `sessions` in the initial migration |
| Community source row | `data_sources` id `…0003` in `supabase/seed.sql` |
| Tests | `services/api/src/app.test.ts` — "farmer channel" |

## Identity and privacy

A USSD or SMS caller has no `auth.users` row, so `conversations.owner_id` is nullable and those
rows are keyed by `channel_identity_hash`: a salted sha256 of the MSISDN, computed server-side
from `FIELD_REPORT_SALT`. A table check requires one identity or the other. The API rejects any
`session_ref` shaped like a phone number rather than hashing it silently, and never echoes the
reference back. Because the ownership policies compare `auth.uid()` to `owner_id`, channel-owned
conversations are invisible to `anon` and `authenticated` and must be reached through the service
role. Raw phone numbers do not enter the database or analytics events.

## Not yet built

Live Africa's Talking provider webhooks, USSD menu-state machine and per-channel formatters, IVR
and WhatsApp adapters, persistence of accepted reports into `conversations` / `evidence_records`
with a `provenance_events` link, and the verification workflow that would let a reviewed community
report raise or lower confidence on a claim. `POST /api/field-reports` returns `persisted: false`
to keep that boundary explicit.
