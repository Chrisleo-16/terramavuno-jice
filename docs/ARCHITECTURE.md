# Architecture

```text
Browser (React/Vite)                     Feature phone / farmer channel
  ├─ Cesium globe / SVG 2D fallback        ├─ USSD menu session (stateful, no account)
  ├─ TerraTime state + evidence labels     ├─ SMS advisory out / report in
  └─ Climate simulator UI                  └─ IVR + WhatsApp (later adapters)
          │ HTTP                                   │ provider webhook (server-side keys)
          └───────────────┬────────────────────────┘
                          │
API (Express/TypeScript)
  ├─ validated simulator endpoint
  ├─ Claude tool definitions (map, compare, simulate, report, record_field_report)
  └─ channel adapters: one conversation state, per-channel formatting
          │ server credentials only
Supabase (Postgres + PostGIS + Auth + Storage)
  ├─ geography + time-series observations
  ├─ budgets/interventions/simulations/programmes/assets
  ├─ conversations/sessions keyed by account *or* hashed channel identity
  └─ evidence, audit and provenance
```

Both clients are first-class. The browser is how a county officer compares options; the feature-phone channel is how the affected farmer receives the result and reports back. Neither is a view onto the other — they share conversation state and the same evidence tables, and the inbound path is the only source of `community`-classified observations in the model.

`packages/shared` is the single source of truth for deterministic simulation logic and Claude tool schemas. Provider adapters should normalize incoming records into `data_sources`, `observations` and `provenance_events`. The UI never receives Supabase secret/service credentials. Public reference tables use narrow read grants plus RLS; user-owned data uses ownership policies.

Channel identity: a USSD or SMS caller has no `auth.users` row, so `conversations.owner_id` is nullable and such rows are identified by `channel_identity_hash` (a salted hash of the MSISDN, computed server-side). A table-level check requires one of the two. Because the ownership policies compare `auth.uid()` to `owner_id`, channel-owned rows evaluate to NULL and are therefore invisible to `anon` and `authenticated` — inbound writes and channel reads must go through the service role in the API, which is also where the salt lives. Raw phone numbers never reach the database.

## Farmer channel

Africa's Talking posts three form-encoded callbacks, all under a secret path segment
(`CHANNEL_WEBHOOK_TOKEN`, compared in constant time) because AT does not sign its webhooks:

| Callback | Route | Contract |
|---|---|---|
| USSD | `POST /channels/:token/ussd` | `sessionId, serviceCode, phoneNumber, text` → `text/plain` `CON …` or `END …` |
| Incoming SMS | `POST /channels/:token/sms/inbound` | `from, to, text, id, linkId, date` → `200`, empty body |
| Delivery report | `POST /channels/:token/sms/delivery` | `id, status, phoneNumber, failureReason` → `200` |

**USSD is stateless per request.** AT replays every keypress in the session as `text`, joined by
`*` — `""`, then `"1"`, then `"1*makueni"`. So `renderUssd(text)` in `packages/shared` is a pure
function of the input path and needs no session store to draw the next screen; `conversations` and
`sessions` exist for audit and for the report a session produces, not for menu state. That is also
why a mistyped county can be retried forever: the county prompt reads the *last* input, so
`1*zzz*makueni` resolves without losing the branch.

Two limits are enforced in code because exceeding either fails silently in the field:

- **USSD 182 septets** including the `CON `/`END ` prefix (3GPP 23.038). `renderUssdPayload`
  truncates on a word boundary rather than letting the carrier drop the whole reply.
- **SMS 160 septets** for one billed segment. Every advisory is asserted to fit one segment for all
  47 counties. On a channel justified by cost per farmer reached, a template that spills into a
  second segment doubles the price of the reach figure the simulator advertises. A single smart
  quote forces UCS-2 and cuts capacity to 70, so templates are normalised into GSM-7.

Handlers reply before performing effects and always return `200`: a non-2xx makes AT retry inbound
SMS and kills a USSD session with a carrier error instead of showing the caller anything.

### Persistence

`ChannelStore` has two implementations, selected at startup: `SupabaseChannelStore` when
`SUPABASE_URL`/`SUPABASE_SECRET_KEY` are present, `InMemoryChannelStore` otherwise so the channel
still runs with no database. `GET /health` reports which is live, and a report that was not written
says `persisted: false` rather than implying a write.

An accepted report becomes three writes:

| Table | Contents |
|---|---|
| `conversations` | upsert on `(channel, channel_identity_hash)`, `owner_id` null |
| `evidence_records` | `claim` = the observation, `area_id` resolved from the county, `classification` via the community `source_id`, `verification_status = 'unverified'` |
| `provenance_events` | `input_hash`/`output_hash`, a human-readable `transformation`, and the `conversation_id` link |

Three decisions worth knowing:

- **The conversation link lives in `provenance_events`, not in the public columns of
  `evidence_records`.** `anon` can read verified evidence, so an exposed `conversation_id` would let
  an anonymous reader group several verified claims back to one reporter. The migration revokes
  table-level `select` and re-grants it column by column, omitting `conversation_id` and
  `source_record_id`.
- **Idempotency is a unique index, not a code check.** Africa's Talking re-posts inbound SMS when a
  callback does not return 2xx. `evidence_records(source_id, source_record_id)` is unique, the
  write is an upsert with `ignoreDuplicates`, and a recognised retry also suppresses the duplicate
  acknowledgement SMS — otherwise a retry storm both doubles the reports and bills for every ack.
- **Opt-out is keyed to the identity hash, not to a conversation.** `channel_preferences` is a
  separate table so `STOP` sent over SMS also silences the USSD advisory path. It carries RLS with
  no policies and no grants: consent state is reachable only through the service role.

The upsert conflict targets require non-partial unique indexes, because `on conflict` cannot target
a partial index without repeating its predicate. Under the default `NULLS DISTINCT` those indexes
leave account-owned conversations unconstrained anyway.

The interface borrows general interaction ideas from God’s Eye View—fly-to, layers, temporal replay, terrain, route/distance, nearby entities and voice tools—but the implementation and visual language are agriculture-focused. AGRION is architecture-only because its cloned source has no explicit license.

