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

