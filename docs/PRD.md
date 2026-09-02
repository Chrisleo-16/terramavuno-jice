# Product requirements — TerraMavuno: "Kilimo, Nitapata?"

> **Know before you queue.**

## Problem

Kenya's National Fertilizer Subsidy Programme reaches millions of registered smallholders, but the answer to the only question a farmer actually has — *"will I get the input, what will I pay, and where do I go?"* — is scattered across a farmer register, ministry circulars, gazetted price notices, depot stock realities and word of mouth. Farmers routinely travel to a depot, queue, and only then discover a missing ID linkage, an acreage cap, or an empty store. The cost of a wrong answer is a wasted day and lost planting time.

## The pivot: why we replaced the flagship question

Earlier drafts of TerraMavuno asked *"where should a county prioritise a climate intervention, given a budget?"* We replaced it deliberately:

- **It was not answerable honestly at hackathon scale.** Prioritisation requires calibrated cost catalogues, beneficiary data and impact models we do not have; any output would be false precision dressed as advice.
- **The programme-rules question IS answerable.** Subsidy eligibility is defined by *published rules* — a register, an ID linkage, an acreage cap, a participating-ward list, gazetted prices. A deterministic engine can evaluate them, cite every criterion, and say exactly what it cannot verify (today's depot stock).
- **It serves one real person, not an abstract planner.** A single farmer with a token code gets a concrete, actionable, cited answer — and the honesty machinery (provenance, evidence tags, uncertainty) that made the old vision credible transfers intact.

The county-planner ambition survives as platform direction, not as a P0 claim.

## The ONE P0 user

**A registered smallholder** in Kandara constituency, Murang'a county, who asks (by text or voice, in English or Kiswahili): *"Nina mbolea ya ruzuku? I'm registered — will I get subsidized fertilizer, what will I pay, and where do I go?"*

An extension officer may operate the screen on the farmer's behalf; that is an assist, **not a second product journey**. There is exactly one P0 journey.

## P0 scope (the eight items)

1. **Cinematic globe** — a CesiumJS globe forked from God's Eye View (MIT), rebranded TerraMavuno, orbiting into Kenya and flying to Murang'a; boots keyless on Esri imagery, upgrades to Google photoreal / Cesium ion when keys exist.
2. **Kenya spatial layers** — Murang'a county outline, the six Kandara wards (Ng'araria, Muruka, Kagundu-ini, Gaichanjiru, Ithiru, Ruchu), depot markers coloured by stock status, farmer-token markers, programme and price cards.
3. **Deterministic eligibility engine** (`packages/shared`) — pure TypeScript, no I/O, unit-tested. Evaluates a farmer token against published programme rules and returns a `Decision` with a per-criterion trace. The engine decides; nothing else does.
4. **Claude explains, never decides** — an agentic chat loop (`POST /api/chat`, SSE) where Claude calls `evaluate_farmer`, restates the Decision in plain language (English plus one Kiswahili summary line), cites every fact, and drives the camera/layers/result card via UI tools.
5. **ElevenLabs voice agent** — the same tool layer exposed to a voice agent via a server-signed URL; feature-flagged, falls back to chat.
6. **Evidence chips on every fact** — every displayed fact carries its Authority × Derivation × Freshness tag (see truth model below).
7. **Result card** — conclusion pill, token + ward, per-criterion trace with evidence chips, allocation, subsidized vs market price, depot with stock freshness, next action, SIMULATED watermark where applicable; shareable (stretch: WhatsApp).
8. **One deliberate honest-uncertainty ("sijui") case** — farmer K-004 is routed to a depot whose stock status is `unknown`; the product says so, verbatim, instead of guessing.

## Demo data (canonical)

- Programme `ken-fert-subsidy-2026`, "National Fertilizer Subsidy Programme", season 2026 Long Rains, source "MoALD subsidy circular", effective 2026-08-14.
- Criteria: `in_register`, `id_linked`, `acreage_max` (5 acres), `ward_participating`, `stock_available` — each with its own evidence tag.
- Allocation: 2 bags/acre, max 10, per 50 kg bag. Prices: KES 2,500 subsidized vs KES 6,500 market ("Kenya Gazette price notice", valid 2026-08-14 → 2026-12-31).
- Four synthetic farmer tokens (K-001 confirmed-eligible, K-002 missing ID linkage, K-003 over acreage cap, K-004 the sijui case) plus support for an `inFarmerRegister: "unknown"` farmer → `cannot_determine`.

## Truth model

Every fact carries three **independent** fields plus a conclusion class:

| Axis | Values | Meaning |
|---|---|---|
| **Authority** | `official` \| `reported` | Who stands behind it — a government source vs anyone else |
| **Derivation** | `direct` \| `calculated` \| `inferred` \| `simulated` | How we got it — read verbatim, computed from official inputs, deduced, or invented for the demo |
| **Freshness** | `checkedAt` timestamp + `current` \| `stale` \| `unknown` | When it was last verified |

Operational conclusions (what the farmer is told):

- **`confirmed`** — all criteria evaluated against official, direct evidence with current stock. A confirmed *negative* (K-002, K-003) is still `confirmed`: we are sure of the answer, even when the answer is no.
- **`indicated_by_published_rules`** — the rules say yes, but something operational (e.g. stock) cannot be verified right now.
- **`cannot_determine`** — a required input itself is unknown; we refuse to guess.

## Acceptance criteria

- [ ] The app **boots with zero API keys** (Esri imagery, bundled JSON data) and clearly labels simulated values.
- [ ] The eligibility engine is **deterministic and tested**: one test per farmer state, allocation cap, exact sijui string, deep-equal determinism on repeat, and evidence-tag completeness on every trace row.
- [ ] **Every displayed fact carries an evidence chip** (Authority · Derivation · Freshness).
- [ ] The demo includes **one deliberate sijui case** (K-004 → Kabati Agrovet, stock unknown) with the exact sentence: *"Rules indicate you qualify, but I cannot verify today's stock at this depot."*
- [ ] The **result card is shareable** (at minimum copy/text; WhatsApp as stretch).
- [ ] Claude never invents an eligibility outcome, stock level, or price — it always calls `evaluate_farmer` and restates the Decision.
- [ ] No secret key reaches the browser; only `GOOGLE_MAPS_API_KEY` and the Cesium ion token are client-exposed, by design.

## OUT OF SCOPE (P0)

- Greenhouse / BOQ / intervention-cost simulation of any kind.
- Contracts, procurement, or payment flows.
- Aircraft, ships, satellites, submarine cables, news or CCTV feeds (GEV inheritance — stripped).
- A second P0 user journey for a county planner or extension-officer dashboard.
- Live farmer-register integration or any real personal data (synthetic tokens only, e.g. K-001).
- Calibrated confidence percentages from the AI layer.

## STRETCH (only if P0 is done and rehearsed)

- County comparison view (Makueni / Nakuru vs Murang'a programme participation).
- USSD simulator for the same eligibility question.
- WhatsApp share of the result card (Evolution API → Cloud API → `wa.me` deep-link fallback chain).

## Later phases (platform direction, not P0 claims)

Live register/stock ingestion from MoALD/NCPB systems, additional programmes (seed, e-voucher), county planner analytics, report export, and authenticated multi-user collaboration. These remain integrations to earn, not claims to make.

---

## Farmer channel — reach and ground truth

Retained from the farmer-channel workstream. It explains why USSD/SMS is a reach denominator and a ground-truth sensor rather than an optional delivery add-on.

The people a county allocation is spent on cannot open a WebGL globe. Without a feature-phone channel the product's reach is limited to officials with laptops, every observation stays top-down, and the farmers who could confirm or contradict a claim have no return path. USSD and SMS are therefore the reach denominator and the ground-truth sensor for this product, not a delivery convenience added after the analysis is finished.

## Primary P0 journey

1. Choose a Kenyan county and a planning year from 2020 onward.
2. Inspect rainfall, drought, NDVI and infrastructure signals with provenance labels.
3. Compare the county with another county.
4. Enter a budget, objective and horizon.
5. Compare irrigation, protected agriculture, water harvesting, climate-smart crops, extension and blended scenarios.
6. Review reach, time, suitability, impact, evidence strength, risks and unknowns.
7. Deliver the chosen scenario to affected farmers over a feature-phone channel (USSD/SMS) and record what comes back — confirmation, contradiction or a field observation — as `community`-classified evidence attached to the same county and time.

Step 7 closes the loop: it is what turns a spending comparison into a measurable intervention. The `extension-support` option in the simulator already prices digital delivery at a KES 10,000 benchmark per farmer reached, so the channel is inside the headline reach number whether or not it is connected.

- The demo starts with no API keys and clearly distinguishes synthetic/benchmark values.
- 3D and 2D map modes both support county selection.
- At least three layers, one county comparison, KES 10M simulation and 2020–2025 playback are demonstrable.
- Simulation output is deterministic, tested and never described as an official estimate.
- Every durable evidence record can identify its source, time, confidence and transformation.
- User-owned records are protected with RLS; secret/service keys never enter browser code.
- The farmer channel runs in P0: the Africa's Talking USSD and inbound-SMS callbacks are implemented and tested, `record_field_report` accepts inbound reports from `ussd`/`sms`/`ivr`/`whatsapp`/`web`, `conversations` can hold a session for a caller who has no account, and inbound reports land as `community` classification pending verification. Live provider credentials change whether an SMS leaves the building, not whether the channel exists.
- No raw phone number is stored, logged or echoed. Channel identity is a salted hash, and channel-owned conversations are invisible to `anon`/`authenticated` under RLS.
- Carrier limits are enforced in code, not hoped for: a USSD reply always fits 182 septets including its `CON`/`END` prefix, and every county advisory fits one billed 160-septet SMS segment.
- Callers can opt out. `STOP` silences the channel for that identity and is honoured by the USSD advisory path too, because consent is keyed to the identity hash rather than to a conversation.
- An accepted report is durable when Supabase is configured: `conversations` + `evidence_records` + a `provenance_events` row carrying input/output hashes and the transformation. A provider retry is deduplicated by unique index, not by hope, and does not bill a second acknowledgement.
- A verified community claim cannot be traced back to its reporter by an anonymous reader: `conversation_id` is withheld from the public column grant on `evidence_records`.

Live ingestion, official county budget imports, calibrated cost catalogues, voice execution, IVR and WhatsApp adapters, per-identity rate limiting on inbound reports, delivery-report persistence, a verification workflow that promotes `community` reports to verified evidence, report export, farmer cases, logistics, site placement and authenticated collaboration. These remain integrations, not claims of P0 completion.

The distinction for the farmer channel: the **USSD menu, SMS grammar, provider client, webhooks and Supabase persistence** are P0 and tested. What is still missing is the **verification workflow** — reports are stored as unverified community evidence and stay invisible to public readers until someone reviews them, so field truth cannot yet actually move a claim's confidence. That review step, not the plumbing, is now the gap between the channel and the impact claim.
