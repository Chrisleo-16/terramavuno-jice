# Risk and provenance policy

## Core risk taxonomy (retained from the original design, adapted to Kilimo)

- **Decision risk:** the product tells a farmer whether *published rules* indicate eligibility. It is not the programme authority; the depot clerk and the register remain the final word. Conclusions are phrased accordingly (`confirmed` / `indicated_by_published_rules` / `cannot_determine`), and the result card always names a next action a human can take.
- **False precision:** no invented decimals, no percentages without a unit, no AI-generated confidence numbers (see below). Prices carry their validity window; allocations carry their formula (`min(bagsPerAcre × acreage, maxBags)`, tagged `calculated`).
- **Temporal leakage:** observation time (`checked_at`), validity period (price windows), and evaluation time (`evaluatedAt`) are distinct fields and are displayed distinctly. A price valid to 2026-12-31 shown on 2027-01-05 must render as stale.
- **Licensing:** nothing ships without recorded terms (see docs/DATA_SOURCES.md). GEV's CC BY-NC-SA cable data was deleted from the fork; AGRION code is never copied.
- **Bias/coverage:** missing data is not zero. An unknown stock status renders as `unknown`, never as "out of stock" or "in stock".
- **Security:** service/secret keys remain server-side; RLS is enabled on all public tables; public grants are read-only and intentional.

Every durable claim links to a `data_sources` row and, when transformed, a `provenance_events` record with input/output hashes and a human-readable transformation. Conflicting sources are retained and surfaced, never silently overwritten.

## The engine decides; Claude explains — and why

Eligibility is computed **only** by the deterministic engine in `packages/shared/src/eligibility/` (pure function, unit-tested, no I/O). Claude is contractually (via system prompt) and structurally (via tool design) limited to calling `evaluate_farmer` and restating its `Decision`.

Why this separation is non-negotiable:

1. **No undefined allocation model.** If an LLM could produce "you'll get about 5 bags", there would be no formula anyone could audit, test, or correct. The engine's formula is one line of cited arithmetic.
2. **No numerical AI confidence unless calibrated.** An LLM saying "85% likely eligible" is a fabricated statistic — we have no calibration data to back any such number. The truth model's categorical conclusions (`confirmed` / `indicated` / `cannot_determine`) carry exactly the certainty we can defend, and no more.
3. **Reproducibility.** The same farmer, programme, prices and depots must always yield a deep-equal Decision (this is a unit test). A farmer told "no" can be shown *which criterion* failed and *whose evidence* said so.

## The three-field truth model (replacing the old label soup)

Earlier drafts used a single mixed vocabulary — LIVE / OFFICIAL / REPORTED / INFERRED / SIMULATED — which conflated **who says so** with **how we got it** with **how fresh it is**. "Live" is a *time* property; "official" is an *authority* property; a fact can be official AND stale, or reported AND current. Collapsing them into one label forced dishonest choices.

The replacement — three independent fields on every fact:

| Field | Values | Question answered |
|---|---|---|
| **Authority** | `official` \| `reported` | Who stands behind this? |
| **Derivation** | `direct` \| `calculated` \| `inferred` \| `simulated` | How did we obtain it? |
| **Freshness** | `checkedAt` + `current` \| `stale` \| `unknown` | When was it last verified? |

Examples: the gazetted price is `official · direct · current (2026-08-14)`; the 4-bag allocation is `official · calculated · current` (official inputs, our arithmetic, formula cited); Kabati Agrovet's stock is `reported · simulated · unknown (never checked)` — and the UI must show exactly that.

## Honest-uncertainty policy (the sijui case)

When the rules pass but an operational fact cannot be verified, the product does not round up to "yes". Farmer K-004 qualifies under every published criterion, but their assigned depot's stock status is `unknown` with `checked_at: null`. The conclusion is `indicated_by_published_rules` and the card and Claude both say, verbatim:

> "Rules indicate you qualify, but I cannot verify today's stock at this depot."

This is a *feature under test* (the string is asserted in `engine.test.ts`), not an error state. Similarly, if a farmer's own register status is the string `"unknown"`, the conclusion is `cannot_determine` — the system refuses to guess in either direction. Saying "sijui" (I don't know) precisely, with a next action, is the product's core credibility claim.

## Farmer PII minimisation (Kenya DPA 2019 posture)

- **No real personal data exists anywhere in the repo or database.** Farmers are synthetic token codes (K-001…K-004) with invented attributes.
- Even in the synthetic schema we model the minimal shape a production system should hold: `nationalIdLinked` is a **boolean flag**, never an ID number; no names, no phone numbers, no GPS of homesteads (farmers are pinned to ward centroids).
- If this ever ingests real register data: token-code indirection stays; identifiers are hashed; phone numbers never enter analytics events; access is per-row RLS; and the system becomes a data processor under the Kenya Data Protection Act 2019, requiring a lawful basis, ODPC registration posture, and data-subject rights handling. None of that is claimed for P0.

## Demo-day risks

| Risk | Mitigation |
|---|---|
| **No Google photoreal 3D mesh over rural Murang'a** (coverage is city-centric) | Plan A: photoreal beat over Nairobi only, then fly to Murang'a on aerial imagery where our polygons and labels carry the look. Never promise photoreal Kandara. Pre-warm the demo flight path on venue Wi-Fi to cache tiles. |
| **ElevenLabs voice latency / event Wi-Fi** | Voice is feature-flagged on signed-url success; >3 s connect or any error → automatic "voice unavailable — using chat". Text chat is the rehearsed primary; phone hotspot is the backup network. |
| **Approximate ward geometry** | Ward polygons are simplified (mapshaper, <~300 KB) and centroids approximate; the UI must label geometry as approximate and never present boundaries as authoritative for legal/administrative purposes. |
| **Supabase unreachable** | 1.5 s provider timeout → bundled JSON; a `dataMode: bundled` badge appears so we never silently pretend live data. |
| **Accidental secret exposure** | Only two client-exposed keys, both restricted (see docs/API_KEYS.md); the Supabase personal access token never enters `.env` or git. |
