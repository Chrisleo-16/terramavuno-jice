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

The interface borrows general interaction ideas from God’s Eye View—fly-to, layers, temporal replay, terrain, route/distance, nearby entities and voice tools—but the implementation and visual language are agriculture-focused. AGRION is architecture-only because its cloned source has no explicit license.

