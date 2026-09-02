# Architecture

TerraMavuno is an npm-workspaces monorepo. The browser app is a vanilla JS + CesiumJS + Vite globe forked from God's Eye View (MIT); all secrets and server logic live in a small Express service; data lives in Supabase with a bundled-JSON fallback so the demo survives offline.

```text
┌─────────────────────────────────────────────────────────────────────┐
│ BROWSER — apps/globe (@terramavuno/globe)                           │
│   vanilla JS + CesiumJS + Vite (forked from God's Eye View, MIT)    │
│   • cinematic camera, ward/depot/farmer/programme/price layers      │
│   • chat panel (SSE client) + ElevenLabs voice client               │
│   • result card + evidence chips                                    │
│   • runMavunoAction(): executes UI tools (fly_to, layers, card)     │
│   client-exposed keys ONLY: GOOGLE_MAPS_API_KEY, Cesium ion token   │
│   bundled kilimo-fallback.json → map renders with ZERO network      │
└───────────────┬─────────────────────────────────────────────────────┘
                │  Vite dev proxy:  /api  →  http://localhost:8787
┌───────────────▼─────────────────────────────────────────────────────┐
│ SERVER — services/api (@terramavuno/api, Express :8787)             │
│   holds ALL secrets (Anthropic, ElevenLabs, Supabase secret key)    │
│   • POST /api/chat        — SSE agentic loop (Claude tool-use)      │
│   • GET  /api/voice/signed-url — ElevenLabs signed session URL      │
│   • /api/kilimo/*         — programme / prices / depots / farmers   │
│   • tools/executor.ts     — ONE executor shared by chat AND voice   │
│   • data/provider.ts      — Supabase read w/ 1.5 s timeout          │
│                              → falls back to bundled JSON           │
└───────────────┬─────────────────────────────────────────────────────┘
                │  server credentials only (SUPABASE_SECRET_KEY)
┌───────────────▼─────────────────────────────────────────────────────┐
│ SUPABASE — Postgres + PostGIS + RLS                                 │
│   administrative_areas (PostGIS) · programmes · subsidy_prices      │
│   infrastructure_assets (depots) · farmer_tokens (synthetic, K-001) │
│   data_sources · evidence_records · provenance_events               │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│ packages/shared (@terramavuno/shared) — SINGLE SOURCE OF TRUTH      │
│   eligibility/engine.ts — deterministic, pure, no I/O, tested       │
│   tools/kilimo-tools.ts — tool schemas used by BOTH Claude chat     │
│                           and the ElevenLabs voice agent            │
│   data/kilimo-fallback.json — bundled data snapshot                 │
└─────────────────────────────────────────────────────────────────────┘
```

## Principles

1. **The engine decides; Claude explains.** Eligibility is computed by a pure, deterministic, unit-tested function in `packages/shared/src/eligibility/`. Claude's only job is to call `evaluate_farmer`, restate the resulting `Decision` in plain language with citations, and drive the map. Claude can never produce an eligibility outcome the engine did not.
2. **One tool layer, two AI frontends.** `packages/shared/src/tools/kilimo-tools.ts` defines every tool schema once. The Claude chat loop consumes it directly; `scripts/print-elevenlabs-tools.mjs` emits the same schemas as JSON for the ElevenLabs agent dashboard. No schema drift by construction.
3. **Keyless-first.** With zero keys the globe boots on Esri imagery and the layers render from the bundled fallback JSON. Every key adds capability; no key is load-bearing for a basic demo.
4. **Secrets stay server-side.** Only `GOOGLE_MAPS_API_KEY` and the Cesium ion token are injected into the browser bundle (both restricted, both visible in devtools by design — see docs/API_KEYS.md). Everything else lives in `services/api`.

## Deliberate difference from God's Eye View

GEV is a single Vite package whose 7,700-line `vite.config.js` contains roughly **20 proxy middlewares** doing server work (key relaying, upstream API proxying, realtime session minting) inside the dev server. That works for a single-user desktop tool but couples server logic to the bundler and makes secrets handling fragile.

TerraMavuno keeps `apps/globe/vite.config.js` **thin** (~150 lines: cesium plugin, env `define` for the two client-exposed keys, `server.fs.deny` for `.env`, and exactly one proxy rule — `/api → http://localhost:8787`). All server behaviour lives in `services/api`, an ordinary Express app that can be tested, deployed and secured independently of the frontend build. This is the clean split GEV never did.

What we **kept** from GEV (with attribution in `apps/globe/NOTICE.md`): the Cesium bootstrap (chrome off, MSAA, credit container), the imagery fallback chain (google-direct → google-ion → keyless esri), the HUD/panel framework and glass visual language, the world-overlay label system with its allocation worker, the camera verbs, and the tool-runner invariants ported from `gevActions.js` (dedupe consecutive identical calls; a newer `fly_to` supersedes an in-flight one; every tool call gets answered; AbortController per turn).

## The `Decision` object — the contract

`Decision` (defined in `packages/shared/src/eligibility/types.ts`) is the single contract between the engine, Claude, the voice agent, and the result card. All four consume it unmodified:

```
Decision {
  conclusion: 'confirmed' | 'indicated_by_published_rules' | 'cannot_determine'
  eligible: boolean
  missingRequirement?: string        // first failing criterion's label
  allocationBags?: number            // min(bagsPerAcre × acreage, maxBags), tagged calculated
  pricePerBagKes?: number            // subsidized
  marketPriceKes?: number
  depot?: { id, name, stockStatus, checkedAt, freshness }
  trace: CriterionResult[]           // one row per criterion: pass|fail|unknown + EvidenceTag
  citations: SourceRef[]
  evaluatedAt: string                // ISO timestamp
  nextAction?: string                // e.g. "Visit the ward agricultural office…"
  sijui?: string                     // the exact honest-uncertainty sentence, when applicable
}

EvidenceTag {
  authority: 'official' | 'reported'
  derivation: 'direct' | 'calculated' | 'inferred' | 'simulated'
  freshness: { checkedAt: string | null, status: 'current' | 'stale' | 'unknown' }
  sourceId: string
  citation: string
}
```

The chat loop returns the Decision as a `tool_result` to Claude; the system prompt requires Claude to restate it verbatim in meaning (never alter numbers or conclusions). The result card renders the same object. The voice agent receives the same object through the same `/api` executor. If the card, the spoken answer and the chat text ever disagree, that is a bug in exactly one renderer — never an ambiguity about the truth.

## Tool inventory

| Tool | Kind | Executed by |
|---|---|---|
| `fly_to_location` | UI | browser (`runMavunoAction`) |
| `set_layer_visibility` | UI | browser |
| `show_result_card` | UI | browser |
| `get_programme` | data | server executor → provider |
| `get_price_schedule` | data | server executor → provider |
| `get_depots` | data | server executor → provider |
| `get_farmer` | data | server executor → provider |
| `evaluate_farmer` | data | server executor → **engine** |

In the chat loop, UI tools are emitted to the browser as SSE `client_action` events and answered server-side with `{ok: true, note: 'dispatched to map'}` so the agentic loop never stalls waiting on the browser (GEV's every-call-answered invariant, achieved by construction; the tradeoff — the model does not learn whether the camera move landed — is accepted and documented).

## Data & failure modes

- `data/provider.ts` reads Supabase with a 1.5 s AbortController timeout per read; on timeout or error it serves `kilimo-fallback.json` and stamps the response `dataMode: 'bundled'` (surfaced as a badge in the UI).
- The globe imports the fallback JSON directly, so wards, depots and farmer markers render with zero network and zero keys.
- Voice is feature-flagged on a successful `GET /api/voice/signed-url`; any error or >3 s connect shows "voice unavailable — using chat".

## Security posture (unchanged from the original design, adapted)

- RLS enabled on all public tables; public grants are read-only and intentional; user-owned rows use ownership policies.
- The browser never receives `SUPABASE_SECRET_KEY`, `ANTHROPIC_API_KEY` or `ELEVENLABS_API_KEY`.
- `farmer_tokens` holds synthetic token codes only (K-001…): no names, no phone numbers, no national ID values — only a boolean `nationalIdLinked` flag.
- `references/agrion` is unlicensed: ideas only, no code copied. `references/gods-eye-view` is MIT: code copied with attribution in `apps/globe/NOTICE.md`.

---

## Second surface — the farmer channel

Kilimo, Nitapata? answers a farmer who can reach a browser or a voice agent. The farmer channel reaches the feature phone, and is the return path for community-classified ground truth. Both surfaces share `services/api`, `packages/shared` and the same Supabase provenance model.

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
