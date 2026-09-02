# TerraMavuno

Kenya-first spatial intelligence for climate action and agriculture. TerraMavuno turns a county, budget, objective and planning horizon into transparent intervention comparisons, then places those options alongside time-based evidence on a Cesium globe with a 2D fallback.

## P0 demo

- Cesium 3D Kenya operating picture using OpenStreetMap tiles, with a no-WebGL 2D fallback
- county fly-to and Makueni/Nakuru-style comparison
- rainfall, drought, NDVI and water-infrastructure evidence layers with source/freshness/confidence labels
- TerraTime playback from 2020 onward
- Climate Action Simulator preloaded with **KES 10,000,000** and six intervention choices
- working Africa's Talking farmer channel: USSD menu (outlook, field report, SMS advisory) and inbound SMS grammar (`REPORT <county> …`, bare county name, `STOP`/`START`), with hashed reporter identity, no raw phone numbers, and carrier limits enforced in code
- Claude-compatible tool schemas and a small HTTP API
- Supabase/Postgres/PostGIS migrations, RLS, provenance model, 47-county seed
- durable farmer-channel storage: an inbound report writes `conversations` + `evidence_records` + `provenance_events`, deduplicated against provider retries by unique index, with the reporter link withheld from public reads

All dashboard values are visibly marked **SIMULATED BENCHMARK**. They are not official costs, forecasts or programme claims.

## Quick start

Requires Node.js 22+.

```powershell
npm install
npm run dev
```

Open `http://localhost:5173`. In another terminal, optionally run `npm run dev:api` and open `http://localhost:8787/health`.

For Supabase local development, install Docker Desktop, then run `npx supabase start` and `npx supabase db reset`. The latter applies the migration and `supabase/seed.sql`.

See [RUNBOOK](docs/RUNBOOK.md), [API keys](docs/API_KEYS.md), [demo script](docs/DEMO_SCRIPT.md), and [provenance policy](docs/RISK_AND_PROVENANCE.md).

## Repository map

`apps/web` demo UI • `services/api` API and Africa's Talking webhooks • `packages/shared` simulator, tool schemas, USSD menu and SMS logic • `packages/geo` geography boundary • `packages/ui` future design system • `modules/*` domain boundaries • `supabase/migrations` database • `data` licensed/generated seed inputs • `references` isolated upstream clones • `docs` product/operations • `scripts` repeatable utilities.

For the farmer channel see [omnichannel](modules/omnichannel/README.md) and the Africa's Talking section of the [RUNBOOK](docs/RUNBOOK.md).

## License

TerraMavuno implementation is provided under [MIT](LICENSE). Upstream code and data remain under their own terms; see [references/README.md](references/README.md) and [data sources](docs/DATA_SOURCES.md).

