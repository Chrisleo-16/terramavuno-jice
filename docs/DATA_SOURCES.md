# Data sources, licences and attribution

Every dataset, code fork and document TerraMavuno ships or cites, with its licence and what that licence obliges us to do. A visible map layer is never evidence of redistribution rights — this table is.

## Source-of-record table

| Source | What we use | Licence / status | Attribution obligation |
|---|---|---|---|
| **God's Eye View** (Bilawal Sidhu, github.com/bilawalsidhu/gods-eye-view) | Forked application code: Cesium bootstrap, imagery chain, HUD/panels, world-overlay labels, camera verbs, glass CSS | **MIT** | Licence text + repo URL in `apps/globe/NOTICE.md`. Required and present. |
| **Natural Earth** (bundled via GEV assets) | Coastline/land base geometry | **Public domain** | None required; credited in NOTICE.md as courtesy. |
| **kenya-locations** (David Amunga, `references/kenya-locations`) | County/constituency/ward **names and codes** (Murang'a = 021; Kandara's 6 wards). No coordinates. | **MIT** | Licence notice retained; credited in NOTICE.md. |
| **geoBoundaries** KEN ADM1 (counties) + ward-level boundaries via HDX/IEBC | County and ward **polygons**, simplified via mapshaper by `scripts/fetch-kenya-geometry.mjs` | **CC BY 4.0** — attribution REQUIRED | "Boundary data: geoBoundaries (geoboundaries.org), CC BY 4.0" must appear in the app credits and in NOTICE.md. Do not remove. |
| **MoALD subsidy circular** (National Fertilizer Subsidy Programme, 2026 Long Rains, effective 2026-08-14) | Programme rules: register requirement, ID linkage, 5-acre cap, participating wards, allocation formula (2 bags/acre, max 10) | Official government document — **cited**, not redistributed | Cite by name and date on every derived fact (evidence chips do this). ⚠️ See "demo caveat" below. |
| **Kenya Gazette price notice** | Prices: KES 2,500 subsidized vs KES 6,500 market per 50 kg bag, valid 2026-08-14 → 2026-12-31 | Official publication — cited | Cite by name and validity window on price chips. ⚠️ See "demo caveat". |
| **NCPB depot list** | The one real depot: NCPB Sagana Depot (`ncpb-sagana`) | Official listing — cited | Tagged `official · direct` with `checked_at` timestamp. |
| **Synthetic agro-dealers** (Kabati Agrovet, Kagundu-ini Farm Supplies, Kenol Agro Centre) | Depot markers + stock statuses for the demo | **SIMULATED** — invented by us | MUST be labelled `SIMULATED` in-app (tag `reported · simulated` + watermark). Never present as real merchants. |
| **Synthetic farmer tokens** (K-001…K-004) | The four demo farmers | **SIMULATED** — no real people | `SIMULATED` watermark on farmer layer and result card. No PII exists to protect, and none may be added. |
| **Google Map Tiles API** (photorealistic 3D tiles) | Optional cinematic basemap | Proprietary; **BYOK**; Google terms apply | Google's on-map attribution/credit is rendered by Cesium's credit container and **must stay visible** (do not hide `.cesium-credit-*`). No tile caching beyond what the API permits. |
| **Cesium ion** (ion imagery/terrain, optional Bing) | Optional basemap/terrain | Proprietary; BYOK; ion terms | ion credits render in the credit container and must stay visible. |
| **Esri World Imagery** (keyless fallback) | Zero-key basemap | Esri terms of use | Esri attribution renders via Cesium credits; must stay visible. |

## What is real-sourced vs simulated in the demo

**Real-sourced (official, cited):** programme name and season framing, criteria structure, the 5-acre cap, the 2-bags/acre and 10-bag allocation, the 2,500/6,500 KES price pair, ward names/codes, county/ward geometry, NCPB Sagana as a real depot type.

**Simulated (labelled in-app):** the three non-NCPB agro-dealers and all of their stock statuses and `checked_at` timestamps; all four farmer tokens and every attribute on them (acreage, crops, redemptions); depot stock at Sagana itself is a demo value; ward centroids used for farmer markers are approximations.

> **Demo caveat (honesty about our own citations):** the specific circular and gazette notice named above are the demo's *citation shapes* — the truth model requires every fact to carry a named source, and these are the named sources the seed data claims. **TODO (human before any public/non-hackathon use):** verify the exact MoALD circular reference number/date and the exact Kenya Gazette notice number for the 2026 Long Rains season, and replace the seed `citation` strings with the verified references. Until then the programme facts are best understood as *official-shaped demo data* faithfully representing how the real programme is structured.

## Deleted from the GEV fork (licensing)

- **TeleGeography submarine cable data** (`src/data/local_data/telegeography_submarine_cables/`) was **CC BY-NC-SA** — incompatible with shipping in this project. It was **deleted from the fork**, along with GEV's dams/datacenters/neighborhoods datasets and all ~115 live-feed layer modules (aircraft, ships, satellites, CCTV, news) that are out of scope.
- No OpenAI Realtime code path survives; the voice layer is a new ElevenLabs integration.

## Rules for adding any future source

Before display, every connector must record: licence/terms, publisher, URL, retrieval time, validity time, unit, geography, transformations applied, and an Authority × Derivation × Freshness tag. `references/agrion` remains **unlicensed**: read for ideas only, never copy code or data.
