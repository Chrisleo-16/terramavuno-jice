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
