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

---

## Farmer channel operations

Running and exercising the Africa's Talking USSD/SMS channel.

cd <path-to-repo>\claude-nairobi-impact-jice
Copy-Item .env.example .env.local
npm install

## Farmer channel example

Inbound USSD/SMS return path. `session_ref` is an opaque provider session id; the API salts and
hashes it into `reporter_ref` and rejects anything shaped like a raw phone number.

```powershell
$r = @{ channel='ussd'; location='Makueni'; observation='Short rains failed, replanted twice'; indicator='rainfall_onset'; confidence='limited'; session_ref='ussd-session-7781' } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri http://localhost:8787/api/field-reports -ContentType application/json -Body $r
```

Returns `202` with `classification: community`, `verification_status: unverified` and
`persisted: false`. Set `FIELD_REPORT_SALT` outside local development.

## Africa's Talking USSD/SMS

### 1. Secrets

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # FIELD_REPORT_SALT
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # CHANNEL_WEBHOOK_TOKEN
```

Put both in `.env`, plus `AFRICASTALKING_USERNAME`, `AFRICASTALKING_API_KEY`,
`AFRICASTALKING_ENV=sandbox` and `PUBLIC_API_BASE_URL`.

### 2. Expose the API and register the callbacks

Africa's Talking must reach this API over HTTPS, so for local work tunnel it
(`npx localtunnel --port 8787`, `cloudflared tunnel --url http://localhost:8787`, ngrok — any of
them) and set `PUBLIC_API_BASE_URL` to the public URL. Then:

```powershell
npm run channels:urls
```

That prints the three URLs to paste into the dashboard (USSD callback, Incoming Messages, Delivery
Reports) and refuses to print if a secret is missing or weak.

### 3. Test locally without a provider

The webhooks accept exactly what AT posts, so you can drive them with form-encoded requests:

```powershell
$t = $env:CHANNEL_WEBHOOK_TOKEN
# First USSD screen
Invoke-RestMethod -Method Post -Uri "http://localhost:8787/channels/$t/ussd" -Body @{ sessionId='local-1'; serviceCode='*384*1234#'; phoneNumber='+254712345678'; text='' }
# Report branch: category 1 (rains late), county Makueni
Invoke-RestMethod -Method Post -Uri "http://localhost:8787/channels/$t/ussd" -Body @{ sessionId='local-1'; serviceCode='*384*1234#'; phoneNumber='+254712345678'; text='2*1*makueni' }
# Inbound SMS
Invoke-RestMethod -Method Post -Uri "http://localhost:8787/channels/$t/sms/inbound" -Body @{ from='+254712345678'; to='12345'; text='REPORT Makueni short rains failed'; id='local-msg-1'; linkId='local-link-1' }
```

The USSD reply is plain text beginning `CON ` (session continues) or `END ` (session closes).
`GET /health` reports whether the provider, the webhook token and the identity salt are configured.

### 4. Sandbox

Use the AT simulator from the dashboard to dial the service code and to send SMS to your
shortcode. Sandbox will not deliver to real handsets.

### 5. Persistence

Set `SUPABASE_URL` and `SUPABASE_SECRET_KEY`, then apply the migrations:

```powershell
npx supabase db reset          # local
npx supabase db push           # hosted project
```

`GET /health` tells you which store is live:

```json
"store": "supabase (service role)"        // durable
"store": "in-memory (reports lost on restart)"
```

Service role is required, not a convenience: a USSD caller has no `auth.users` row, so
channel-owned `conversations` have a null `owner_id` and are invisible to every other role under
RLS. Keep the key server-side; never prefix it with `VITE_`.

Verify a stored report:

```sql
select e.claim, e.channel, e.verification_status, a.name as county, p.transformation
from evidence_records e
left join administrative_areas a on a.id = e.area_id
left join provenance_events p on p.entity_table = 'evidence_records' and p.entity_id = e.id::text
where e.source_id = '00000000-0000-0000-0000-000000000003'
order by e.created_at desc limit 5;
```

Reports stay `unverified` and invisible to `anon` until a verification step exists — that is
intended, not a bug.
