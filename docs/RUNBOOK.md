# Runbook

## Web demo

```powershell
cd <path-to-repo>\claude-nairobi-impact-jice
Copy-Item .env.example .env.local
npm install
npm run dev
```

Open `http://localhost:5173`.

## API

```powershell
npm run dev:api
```

Health: `http://localhost:8787/health` • Claude tools: `http://localhost:8787/api/tools`.

## Verify

```powershell
npm run typecheck
npm test
npm run build
```

## Local Supabase

Docker Desktop must be running.

```powershell
npx supabase start
npx supabase db reset
npx supabase status
```

The reset applies `supabase/migrations/*` and `supabase/seed.sql`. Regenerate the licensed county seed after updating the reference clone with `node scripts/generate-kenya-seed.mjs`.

## API example

```powershell
$body = @{ county='Makueni'; budgetKes=10000000; objective='drought-resilience'; horizonYears=3 } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri http://localhost:8787/api/simulations -ContentType application/json -Body $body
```

## Farmer channel example

Inbound USSD/SMS return path. `session_ref` is an opaque provider session id; the API salts and
hashes it into `reporter_ref` and rejects anything shaped like a raw phone number.

```powershell
$r = @{ channel='ussd'; location='Makueni'; observation='Short rains failed, replanted twice'; indicator='rainfall_onset'; confidence='limited'; session_ref='ussd-session-7781' } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri http://localhost:8787/api/field-reports -ContentType application/json -Body $r
```

Returns `202` with `classification: community`, `verification_status: unverified` and
`persisted: false`. Set `FIELD_REPORT_SALT` outside local development.

