# Submission form answers — copy/paste

Verified against the working tree on 2026-09-02. Each block below maps to one form field.

---

## Project name *

```
TerraMavuno — Kilimo, Nitapata?
```

---

## One sentence: who it helps and how *

```
TerraMavuno tells a registered smallholder in Kandara whether the fertilizer subsidy will reach her, which requirement she is still missing, and what the gazetted price is — with a named, dated source on every line, and an explicit "sijui" where the record runs out.
```

---

## Track *

```
Kilimo: Nitapata?
```

---

## This helps ___, who today struggles with ___ *

```
This helps a registered smallholder farmer who today struggles to know whether the depot will serve her, what requirement she is still missing, and what the published scheme says she should pay — so she travels, queues, and finds out at the counter.
```

---

## What it does

```
A judge opens a 3D Kenya globe and types (or speaks) as a farmer: "I'm K-001, registered in Kandara — will I get subsidized fertilizer, what will I pay, where do I go?"

Claude flies the camera to the ward, pulls the programme rules, and calls evaluate_farmer — a deterministic, tested function that decides, not the model. A result card returns one of three verdicts: confirmed, indicated by published rules, or cannot determine. It names the exact criterion that failed or could not be resolved, shows the gazetted price against the market price, and names the depot serving that ward. Every line carries a source chip: publisher, authority level, and the date it was effective.

Ask whether stock is available today and it refuses. Depot stock carries its own checkedAt timestamp; when that reading is stale or absent, the engine automatically downgrades "confirmed" to "indicated by published rules" and emits a fixed sijui string. Claude cannot override that — the downgrade happens before the model sees the result.
```

---

## What works live, and what is mocked *

```
LIVE:
- Cesium 3D globe, Kenya -> Murang'a -> Kandara, six real ward boundaries from geoBoundaries.
- Deterministic eligibility engine (packages/shared/src/eligibility) with three-way output: confirmed / indicated_by_published_rules / cannot_determine. Own test suite.
- Claude chat over streaming SSE with 8 tools: fly_to_location, set_layer_visibility, show_result_card, get_programme, get_price_schedule, get_depots, get_farmer, evaluate_farmer.
- Local HTTP API: /api/chat, /api/evaluate, /api/kilimo/{programme,prices,depots,farmers,evaluate}.
- Africa's Talking USSD + inbound SMS handling: menu logic, 182-char carrier cap, salted-hash reporter identity, no raw phone numbers stored. Tested. Not connected to a live shortcode.
- Graceful degradation: with no ANTHROPIC_API_KEY the map, layers and eligibility endpoints still work.

MOCKED / SYNTHETIC, and labelled as such in the UI (dataMode: "bundled"):
- 5 farmer records, 1 programme, 1 price schedule, 6 wards, 4 depots. NCPB Sagana is a real depot; the other three are simulated agro-dealers, tagged.
- Depot stock status is synthetic. This is why the system refuses live-stock questions rather than answering them.

NOT BUILT - do not credit us for these:
- No page-level citation yet. Sources are cited by document name, publisher, authority tier and effective date (e.g. "MoALD subsidy circular, 2026-08-14"), not document + page. Page anchors are the next thing we would build, and we know that is your question.
- No county comparison UI, no time slider. The 6-option budget simulator exists as a tested library and a POST /api/simulations endpoint, but has no interface - reachable by curl, not by clicking.
- Three fixed scenes (Kenya arrival, Kandara wards, depot run), not free 47-county navigation.
- Kiswahili is Claude mirroring the language it was addressed in. No translation layer, no UI localisation.
- Supabase migrations and seed are written; the local instance was not run. Field reports fall back to memory and report persisted: false.
- No WhatsApp, no live Africa's Talking shortcode, no ElevenLabs voice service running.

TESTS: 160 of 161 passing. One known failure - services/api/src/app.test.ts:175, the field-report endpoint returns 503 instead of 202 because the store throws rather than falling back to memory. We found it in review and are not hiding it.
```

---

## Where Claude sits in the build *

```
Claude is the interpreter, never the adjudicator. Model: claude-sonnet-5 (overridable via ANTHROPIC_MODEL).

What Claude does: retrieves the programme record, drives the camera and layers, calls evaluate_farmer, then translates the returned verdict into plain English or Kiswahili, answers follow-ups, and carries the citations through.

What Claude must never do, enforced in code not just in the prompt:
- Decide eligibility. The verdict comes from a deterministic function; Claude receives it as a tool result.
- State a price that is not in the price schedule.
- Declare live depot stock. Stock has a freshness stamp; a stale or missing reading downgrades the verdict before Claude sees it.
- Turn an uncertain case into a confident one. cannot_determine ships with a fixed sijui string.
- Give agronomic advice. Eligibility and process only.
```

---

## Which AI tools you used

```
Claude and Claude Code: system architecture, the tool schemas, the eligibility engine, the globe app, tests, and this repo's technical docs. Claude Code also audited this submission against the actual source before we filed it, which is how the "not built" list above got written honestly.

ChatGPT and Codex: product research, scope cutting, source evaluation, risk analysis, farmer journey design.

Final product decisions, evidence review and every claim above are ours.
```

---

## Repo link *

```
FILL IN: github.com/<org>/<repo>
```

---

## Backup video / Video link / Screenshot link

Optional. `docs/media/kilimo-globe.png` exists in-repo if you need a screenshot to upload.

---

## If a judge asks "which document, which page?"

Answer straight, do not bluff:

> Document yes, page not yet. Every claim resolves to a source record with publisher,
> authority tier and effective date — the MoALD subsidy circular of 2026-08-14 for the rules,
> the Kenya Gazette price notice of the same date for the KES 2,500 subsidised and KES 6,500
> market figures. Page anchors are the next thing we build; the source record already has the
> field for it.

---

## Two fixes worth making before the freeze, in this order

1. **Resolve the merge conflicts.** `README.md`, `docs/API_KEYS.md`, `docs/ARCHITECTURE.md`,
   `docs/DEMO_SCRIPT.md`, `docs/PRD.md`, `docs/RUNBOOK.md` all still carry `<<<<<<<` markers.
   The README shows the pre-pivot and post-pivot pitches stacked on top of each other, and it
   is the first file a judge opens.
2. **Fix or delete the `tests 88 passing` README badge.** The real number is 160 of 161.
