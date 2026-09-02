# Bundled Kilimo dataset (`packages/shared/src/data`)

The single offline snapshot that both `services/api` (when Supabase is
unreachable) and `apps/globe` (always, for zero-network rendering) read.
The stage demo must work with the network cable pulled — this directory is
what makes that true.

## Files

| File | Role |
|---|---|
| `kilimo-fallback.json` | **Human-editable source of truth.** The full bundled snapshot. |
| `index.ts` | **Generated** typed module embedding the same data (do not hand-edit the data block). |
| `generate-index.mjs` | Regenerates `index.ts` from the JSON (`node packages/shared/src/data/generate-index.mjs`). |
| `_header.ts.txt` / `_footer.ts.txt` | Type declarations and convenience exports stitched around the generated literal. |
| `data-consistency.test.ts` | Vitest suite: fails if `index.ts` and the JSON drift, if the data drifts from `../eligibility/fixtures.ts`, or if any canonical invariant breaks. |

Why not `import ... from './kilimo-fallback.json'`? This package compiles
with `module: NodeNext` and no `resolveJsonModule`; embedding a generated
literal keeps `@terramavuno/shared` importable from plain Node and Vite
with zero loader configuration, while the JSON stays the editable truth.

## Exports (from `./index.ts`)

Constants: `KILIMO_FALLBACK` (whole snapshot), `KILIMO_PROGRAMME`,
`KILIMO_PRICES`, `KILIMO_DEPOTS`, `KILIMO_FARMERS`, `KILIMO_WARDS`,
`KILIMO_SOURCES`, `KANDARA_WARD_CODES`.

Helpers: `getFarmerByToken`, `getDepotById`, `getWardByCode` (tolerates
apostrophes/hyphens/case), `getSourceById`.

Types: `KilimoFallback`, `FallbackProgramme`, `FallbackDepot`,
`FallbackFarmer`, `WardRecord`, `SourceRecord`.

**Engine compatibility:** `FallbackProgramme extends ProgrammeRules`,
`FallbackDepot extends Depot`, `FallbackFarmer extends FarmerToken` and
prices are plain `PriceRow[]` — all from `../eligibility/types.ts`. Every
record can be passed straight into `evaluateFarmer(farmer, programme,
prices, depots, now)`; the extra fields (`town`, `classification`,
per-record `evidence`, `participatingWardCodes`, ...) exist for map
rendering and citation display. A test asserts record-for-record agreement
with `../eligibility/fixtures.ts`.

## Snapshot shape and field meanings

```
{
  dataMode: "bundled",          // provider stamps "supabase" when live
  generatedAt: ISO timestamp,
  programme: {...}, prices: [...], depots: [...],
  farmers: [...], wards: [...], sources: [...]
}
```

Every fact carries an `EvidenceTag` (from `../eligibility/types.ts`) — the
truth model:

- `authority`: `official` (government-published) | `reported` (anything else, including all synthetic data)
- `derivation`: `direct` | `calculated` | `inferred` | `simulated`
- `freshness`: `{ checkedAt: ISO | null, status: 'current' | 'stale' | 'unknown' }` — the engine recomputes depot stock freshness from `checkedAt` at evaluation time
- `sourceId`: must resolve into the `sources` array (test-enforced)
- `citation`: human-readable provenance sentence

### `programme`
`ken-fert-subsidy-2026`, "National Fertilizer Subsidy Programme", season
"2026 Long Rains", effective 2026-08-14, authority `official`, source
"MoALD subsidy circular". `criteria[]` are the five deterministic tests the
eligibility engine runs — `in_register`, `id_linked`, `acreage_max`
(param 5 acres), `ward_participating`, `stock_available` — each with its
own evidence tag. `allocationFormula`: `{ bagsPerAcre: 2, maxBags: 10 }`
(50 kg bags — bag weight lives on the price row). `participatingWards` are
ward NAMES (the engine's key space); `participatingWardCodes` the matching
kenya-locations codes. `wardCentroids` (keyed by ward name) carry the REAL
calculated centroids used for nearest-depot haversine fallback.

### `prices`
One `PriceRow`: `planting_fertilizer`, subsidized KES 2,500 vs market
KES 6,500 per 50 kg bag, valid 2026-08-14T00:00:00Z →
2026-12-31T23:59:59Z, cited to the Kenya Gazette price notice.

### `depots`
Four collection points. **Only `ncpb-sagana` is real** (NCPB Sagana Depot,
official/direct, cited to the NCPB depot network listing at
https://ncpb.co.ke, stock checked 2026-09-02T06:00Z → current).
`kabati-agrovet` (stock `unknown`, `checkedAt: null` — the deliberate
*sijui* depot), `kagunduini-supplies` (`low`, self-reported 2026-09-01)
and `kenol-agro` (`in_stock`, self-reported 2026-09-02T05:30Z) are
**synthetic** (`classification: "simulated"`, authority `reported`,
derivation `simulated`) placed in real Kandara-area market towns. The
globe copy lives at `apps/globe/src/data/local_data/kenya/depots.muranga.json`.

### `farmers`
Five synthetic tokens (K-001…K-005), zero real personal data, each
exercising one engine state:

| Token | State | Ward | Key attribute | Expected engine outcome |
|---|---|---|---|---|
| K-001 | registered | Ng'araria 0539 | all criteria pass, depot ncpb-sagana current | `confirmed`, eligible, 4 bags |
| K-002 | missing_requirement | Muruka 0540 | `nationalIdLinked: false` | eligible=false, missing `id_linked`, next action ward agricultural office (`confirmed` negative) |
| K-003 | ineligible | Gaichanjiru 0542 | 7.5 acres > 5-acre cap | eligible=false (`confirmed`) |
| K-004 | registered | Ithiru 0543 | assigned depot kabati-agrovet, stock unknown | **sijui**: `indicated_by_published_rules` — "Rules indicate you qualify, but I cannot verify today's stock at this depot." |
| K-005 | unknown | Ruchu 0544 | `inFarmerRegister: "unknown"` | `cannot_determine` |

`assignedDepotId` is provided explicitly so the demo journey is
deterministic regardless of nearest-depot heuristics.

### `wards`
The six Kandara wards with kenya-locations codes (0539–0544),
constituency 109, county 021, and centroids **calculated** from real
geoBoundaries KEN ADM3 geometry (see below) — all near lat -0.85 /
lon 36.95 and pairwise distinct by > 0.02°. They agree with
`programme.wardCentroids` (test-enforced).

### `sources`
Every `sourceId` used anywhere in the snapshot, with publisher, licence
and notes. Synthetic sources are explicit (`simulated-depot-*`,
`simulated-farmer-tokens`).

## Geometry companion files (`apps/globe/src/data/local_data/kenya/`)

Produced by `scripts/fetch-kenya-geometry.mjs` (flags: `--offline`,
`--supabase`, `--max-kb=N`); committed so the demo needs no network:

- `counties.geojson` — all 47 counties, geoBoundaries gbOpen KEN ADM1
  (simplified + decimated to ~210 KB), names joined to kenya-locations codes.
- `muranga_wards.geojson` — all 35 Murang'a wards, geoBoundaries gbOpen KEN
  ADM3, spatially filtered by the Murang'a ADM1 polygon (~58 KB), 0 name misses.
- `centroids.json` — calculated centroids for the 6 Kandara wards + Murang'a.
- `depots.muranga.json` — the 4 depots (same records as in this snapshot,
  plus display extras).

If the script ever has to fall back to approximate geometry it labels every
feature `properties.approximate = true` and
`properties.classification = "simulated"` — approximate polygons are never
presented as official.

## Sources and licences (must be mirrored in `docs/DATA_SOURCES.md`)

| Source | Used for | Licence |
|---|---|---|
| geoBoundaries gbOpen KEN ADM1 (RCMRD GeoPortal) | county polygons | Underlying source Public Domain; geoBoundaries requests citation. Attribution: "Administrative boundaries courtesy of geoBoundaries (www.geoboundaries.org), gbOpen KEN ADM1/ADM3 — Runfola, D. et al. (2020) PLoS ONE 15(4): e0231866, CC BY 4.0." |
| geoBoundaries gbOpen KEN ADM3 (IEBC-derived) | ward polygons + centroids | same attribution as above |
| kenya-locations (`references/kenya-locations`, github.com/DavidAmunga/kenya-locations) | county/constituency/ward names and codes | MIT |
| tigawanna/kenya_wards_geojson_data (GitHub) | documented alternative ward GeoJSON source in the fetch script | MIT |
| HDX "kenya-admin-level-3-wards" (OCHA ROSEA) | documented manual SHP alternative | CC BY |
| NCPB depot network listing (https://ncpb.co.ke) | NCPB Sagana Depot existence | official public listing, cited |
| MoALD subsidy circular / Kenya Gazette price notice | programme rules and prices | official documents, cited |
| TerraMavuno synthetic seed | 3 agro-dealers + 5 farmer tokens | CC0, clearly labelled SIMULATED |

## How to regenerate

```bash
# 1. Refresh geometry (safe offline — never fails the build):
node scripts/fetch-kenya-geometry.mjs            # download + simplify + join
node scripts/fetch-kenya-geometry.mjs --offline  # keep committed files
node scripts/fetch-kenya-geometry.mjs --supabase # also log administrative_areas upserts

# 2. After editing kilimo-fallback.json:
node packages/shared/src/data/generate-index.mjs

# 3. Verify:
npm run test --workspace @terramavuno/shared
```
