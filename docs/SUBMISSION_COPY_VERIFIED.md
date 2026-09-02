# Submission copy — verified against the repository

Reviewed on 2026-09-02 against the working tree on `main`. Every claim below was checked
against source, tests or data files. Where the draft did not match the build, the correction
is given with the file that settles it.

---

## Correction 0 — the product is not called Nielekeze

`Nielekeze` does not appear anywhere in this repository. The built product is:

> **TerraMavuno — *Kilimo, Nitapata?*** ("Farming — will I get it?")

Package name `terramavuno` (`package.json:2`), used throughout the README, the API workspace
`@terramavuno/api`, the shared library `@terramavuno/shared`, and the demo script. If the team
has decided to rename, the rename has not been made in code and the submission would not match
the repo a judge is shown.

The rest of this document keeps the draft's structure and rewrites each section to what exists.

---

## One sentence

> **TerraMavuno tells a registered smallholder in Kandara whether the fertilizer subsidy will
> reach her, what the gazetted price is, and which depot to walk to — with the dated source
> behind every line, and an explicit "I don't know" where the record runs out.**

The draft's "a county support programme" overstates the scope. The build covers **one
programme** — the subsidised fertilizer scheme — in **one constituency**. See
`packages/shared/src/data/kilimo-fallback.json`: 1 programme, 1 price schedule, 4 depots,
5 farmers, 6 wards, 10 sources.

---

## The problem

The draft's framing holds and needs no correction. It matches the README's own statement of
the problem and the demo's opening beat.

---

## What TerraMavuno does

> A farmer identifies herself and her ward. The eligibility engine — a deterministic, tested
> function, not the model — checks her attributes against a structured version of the published
> programme rules. It returns one of three conclusions: **confirmed**, **indicated by published
> rules**, or **cannot determine**. It names the criterion that failed or could not be resolved,
> shows the published price and the depot serving her ward, and attaches a source and a
> freshness stamp to each fact.

Corrections to the draft:

- **"answers a few relevant questions"** — the farmer does not answer questionnaire questions.
  She is looked up by id against a bundled register (`get_farmer`,
  `/api/kilimo/farmers/:token`). There is no intake form in the build.
- **"chooses their location"** — free county choice is not implemented in the farmer flow.
  The scene director ships three scenes: `kenya-arrival`, `kandara-wards`, `depot-run`
  (`apps/globe/src/scenes/recipes.js`).
- The three-way conclusion type is worth naming explicitly; it is the strongest honest claim
  the project has.
  `Conclusion = 'confirmed' | 'indicated_by_published_rules' | 'cannot_determine'`
  (`packages/shared/src/eligibility/types.ts:126`).

---

## What the judge experiences

The draft's walkthrough is accurate in shape, and one detail is understated in the draft's
favour: the refusal is not ad-hoc, it is a typed output. `SIJUI_TEXT`
(`packages/shared/src/eligibility/engine.ts:25`) is emitted whenever an eligibility criterion is
`unknown`, or when every criterion passes but the depot's stock observation is stale or missing
(engine.ts:220–269). A stale stock reading downgrades `confirmed` to
`indicated_by_published_rules` automatically — the model cannot override it.

One correction: the demo farmer is **K-001 in Kandara, Murang'a**, and the outcome for K-001 is
*confirmed*, not "one outstanding requirement" (`docs/DEMO_SCRIPT.md`, Beat 2). The
outstanding-requirement and cannot-determine cases are separate archetypes in
`packages/shared/src/eligibility/fixtures.ts`. Pick the archetype deliberately and describe that
one; do not describe a composite farmer.

---

## Claude's role

The draft is correct and is borne out by the code. Claude is called through
`services/api/src/claude/route.ts` with an eight-tool schema
(`packages/shared/src/tools/kilimo-tools.ts`): `fly_to_location`, `set_layer_visibility`,
`show_result_card`, `get_programme`, `get_price_schedule`, `get_depots`, `get_farmer`,
`evaluate_farmer`. The status comes from `evaluate_farmer`, which calls the engine. Default
model is `claude-sonnet-5`, overridable via `ANTHROPIC_MODEL` (`services/api/src/env.ts:72`).

Add one sentence the draft omits, because it is a real robustness point: with no
`ANTHROPIC_API_KEY` the chat degrades to a typed `chat_unavailable` SSE error while the map,
layers and eligibility REST endpoints keep working (`route.ts:229–236`).

---

## What is live and what is simulated — **substantially corrected**

The teammate's list claims several features that are **not in the interface**.

**Verified present:**

- Cesium globe over Kenya with the three-scene director and Kandara ward polygons.
- Kilimo evidence layers: wards, depots, farmers, prices, programme, evidence badges
  (`apps/globe/src/data/kilimo/`).
- Chat panel over a streaming SSE endpoint, plus a result card
  (`apps/globe/src/chat/`, `apps/globe/src/farmerCard/resultCard.js`).
- Local HTTP API: `/api/chat`, `/api/evaluate`, `/api/simulations`, `/api/field-reports`,
  `/api/kilimo/{programme,prices,depots,farmers,farmers/:token,evaluate}`.
- Deterministic eligibility engine with its own test suite.
- Africa's Talking USSD and inbound-SMS handling with hashed reporter identity and a
  182-character cap, covered by tests (`packages/shared/src/ussd.ts`, `sms.ts`,
  `services/api/src/channels.ts`).
- Supabase migrations (3) and seed SQL.

**Claimed but not built as interface:**

- **County comparison** — no comparison panel exists in `apps/globe/src`.
- **Historical / TerraTime slider** — no timeline control in the globe app.
- **Budget scenario interface** — the six-option simulator exists as a tested library
  (`packages/shared/src/simulator.ts`) and an endpoint (`POST /api/simulations`), but there is
  **no UI for it**. It is reachable by curl, not by a judge clicking.
- **Free county navigation** — three fixed scenes, not 47-county fly-to, in the current app.

**Kiswahili:** the only Kiswahili handling is an instruction in the Claude system prompt to
mirror the farmer's language (`services/api/src/claude/systemPrompt.ts`). There is no
translation layer, no localised UI strings, no language toggle. Describe it as "Claude replies
in the language it was addressed in", not as bilingual support.

**Synthetic data:** correct as drafted. `dataMode: "bundled"`, five synthetic farmers, one real
NCPB depot and three simulated agro-dealers, all labelled.

**Supabase not run locally:** consistent with the build — the field-report path returns
`persisted: false` and a note naming the missing `SUPABASE_URL` / `SUPABASE_SECRET_KEY`
(`services/api/src/app.ts:146`).

---

## Verification status — must be fixed before submission

Ran `npm test` on 2026-09-02:

| Workspace | Result |
|---|---|
| `@terramavuno/shared` | 60 passed / 60 |
| `@terramavuno/api` | 100 passed, **1 failed** / 101 |
| **Total** | **160 passed, 1 failed / 161** |

Two problems with the current claims:

1. **The README badge says `tests 88 passing`.** That number is stale in both directions —
   there are 161 tests and they do not all pass.
2. **One test fails:** `services/api/src/app.test.ts:175` — the field-report endpoint returns
   **503** where the test expects **202**. The 503 branch is the persistence-failure path in
   `app.ts:153`, so the store is throwing rather than falling back to memory. This is the same
   Beat-8 field-report flow the demo script walks through, so it will fail on stage if a judge
   asks for it.

**Do not submit a "tests passing" claim until this is fixed or the claim is reworded.**

---

## Repository hygiene — blocking

Six files are still in an **unresolved merge conflict** from the `kilimo-pivot` merge, with
`<<<<<<<` / `>>>>>>>` markers in the committed text:

```
README.md
docs/API_KEYS.md
docs/ARCHITECTURE.md
docs/DEMO_SCRIPT.md
docs/PRD.md
docs/RUNBOOK.md
```

The README a judge opens first currently shows two contradictory product descriptions stacked
on top of each other — the pre-pivot TerraMavuno feature list and the post-pivot Kilimo
framing. Resolving these is the highest-value fifteen minutes available before submission.

Eight directories under `modules/` contain a `README.md` and nothing else. If they are meant to
read as implemented subsystems, they do not.

---

## AI tools used

The draft's wording is fine and makes no verifiable claim about this repo. Keep it as written.
