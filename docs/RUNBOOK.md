# Runbook (Windows PowerShell first)

## Prerequisites

- **Node.js >= 22** for the repo root (`package.json` engines).
- **The globe workspace needs newer Node**: `apps/globe/package.json` inherits God's Eye View's engines field — **`>=24.14.0 <25 || >=26 <27`**. Practical guidance: install Node 24 LTS (>= 24.14.0) and use it for everything; it satisfies both constraints. Check with `node --version`.
- Git, and (optionally) Docker Desktop for local Supabase.
- No API keys are required to boot — see the keyless expectations below.

## First run

```powershell
cd C:\Users\ADMIN\Documents\GitHub\claude-nairobi-impact-jice
npm install                      # once, at the repo ROOT (npm workspaces installs everything)
Copy-Item .env.example .env      # single .env at the repo root serves both workspaces
# open .env and fill whichever keys you have — see docs/API_KEYS.md for the step-by-step checklist
```

Then **two terminals**:

```powershell
# Terminal 1 — the API (Express, port 8787, holds all secrets)
npm run dev:api

# Terminal 2 — the globe (Vite, proxies /api to 8787)
npm run dev
```

Open **http://localhost:4173**.

## Health checks

```powershell
Invoke-RestMethod http://localhost:8787/health
# expect: a JSON ok/status payload

Invoke-RestMethod http://localhost:8787/api/voice/signed-url
# expect: { signedUrl: "wss://..." } when ELEVENLABS_API_KEY + ELEVENLABS_AGENT_ID are set
# expect: an explicit error payload (and the mic button hidden in the UI) when they are not
```

## Tests

```powershell
npm run test --workspace @terramavuno/shared   # eligibility engine: 4 farmer states, allocation cap,
                                               # exact sijui string, determinism, citation completeness
npm run test --workspace @terramavuno/api      # tool executor + bundled-JSON fallback (mocked Supabase failure)
npm run typecheck                              # all workspaces
npm run build                                  # production build
```

## Supabase (optional — the demo runs on bundled JSON without it)

Hosted project (requires the project ref and a database password):

```powershell
npx supabase link --project-ref gxecynujvqmubkezqpgt
npx supabase db push             # applies supabase/migrations/* (incl. the kilimo migration)
```

Local stack (Docker Desktop must be running):

```powershell
npx supabase start
npx supabase db reset            # applies migrations + supabase/seed.sql (kilimo seed section)
npx supabase status
```

> The Supabase **personal access token** (`sbp_...`) is for local MCP auth only — never in `.env`, never committed. See docs/API_KEYS.md.

## Data regeneration scripts

```powershell
# Rebuild Kenya county/ward geojson + centroids from geoBoundaries/HDX (writes into apps/globe data dir;
# add --supabase to also upsert into administrative_areas)
node scripts/fetch-kenya-geometry.mjs

# Emit the tool schema JSON to paste into the ElevenLabs agent dashboard (client tools)
node scripts/print-elevenlabs-tools.mjs
```

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `EADDRINUSE: 8787` or `4173` | Another instance is running. Find it: `Get-NetTCPConnection -LocalPort 8787 | Select-Object OwningProcess` then `Stop-Process -Id <pid> -Confirm:$false`. |
| Globe boots but imagery looks plain / no photoreal | **Expected keyless mode.** Without `GOOGLE_MAPS_API_KEY` / `VITE_CESIUM_ION_TOKEN` the map uses Esri World Imagery. Wards, depots, farmers and the engine all still work from bundled JSON. |
| Chat returns an error immediately | `ANTHROPIC_API_KEY` missing/invalid in `.env`, or Terminal 1 (`dev:api`) is not running. Check `Invoke-RestMethod http://localhost:8787/health` first. |
| Browser console shows CORS errors on `/api/...` | You opened the API origin directly or bypassed the dev server. Always use http://localhost:4173 — the **Vite proxy** forwards `/api` to 8787 same-origin. If you changed ports, update the proxy target in `apps/globe/vite.config.js` and `VITE_API_URL`. |
| `/api` requests 404 or hang in dev | Vite proxy misconfig or API not started. Confirm `server.proxy['/api']` targets `http://localhost:8787` and Terminal 1 shows the Express listen line. |
| Map shows old/blurry tiles after changing imagery keys | Cesium caches tiles aggressively. Hard-reload with cache disabled (DevTools → Network → Disable cache, then Ctrl+F5), or clear site data for localhost:4173. |
| Voice button missing | By design: it only appears when `GET /api/voice/signed-url` succeeds. Check `ELEVENLABS_API_KEY` and `ELEVENLABS_AGENT_ID`. |
| `dataMode: bundled` badge showing though Supabase is configured | Provider hit its 1.5 s timeout — check `SUPABASE_SECRET_KEY` / network; the demo remains fully functional on bundled data. |
| `npm install` engine warnings for apps/globe | You are on Node 22/23 or 25. Install Node 24 LTS (>= 24.14.0). |
| Git Bash alternative | All commands above work in Git Bash by swapping `Copy-Item .env.example .env` for `cp .env.example .env` and `Invoke-RestMethod` for `curl`. |
