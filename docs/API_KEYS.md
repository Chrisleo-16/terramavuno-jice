# Env & secrets checklist — step by step

One `.env` file at the **repo root** serves both workspaces (the globe reads it via Vite `envDir`; the API via dotenv). Start with:

```powershell
Copy-Item .env.example .env
```

Never commit `.env`. Never put a real value into `.env.example`.

**Exposure legend:**
- **SERVER-ONLY** — read only by `services/api`; must never appear in browser code, bundles or devtools.
- **CLIENT-EXPOSED** — deliberately injected into the browser bundle; anyone can read it in devtools, so it must be a restricted/publishable key.

---

## Minimum keys for an impressive demo (tier list)

| Tier | Keys | What you get |
|---|---|---|
| **0 — zero keys** | none | Full globe on Esri imagery, all Kenya layers, engine + result card from bundled JSON. The demo *works*. |
| **1 — chat** | + `ANTHROPIC_API_KEY` | Claude conversation: ask as K-001, watch the camera fly and the card render. |
| **2 — cinematic look** | + `GOOGLE_MAPS_API_KEY` *or* `VITE_CESIUM_ION_TOKEN` | Photoreal Nairobi / high-quality imagery and terrain. |
| **3 — voice** | + `ELEVENLABS_API_KEY` + `ELEVENLABS_AGENT_ID` (+ `ELEVENLABS_VOICE_ID`) | Spoken farmer questions, the demo flourish. |
| **4 — platform story** | + `SUPABASE_SECRET_KEY` (+ URL/publishable key/`DATABASE_URL`) | Live Postgres/PostGIS/RLS backing instead of bundled JSON. |

Recommended for demo day: tiers 0–3. Tier 4 is optional (the bundled fallback is a feature, not a compromise).

---

## 1. `ANTHROPIC_API_KEY` — SERVER-ONLY

1. Go to **https://console.anthropic.com** → sign in.
2. Left sidebar → **API keys** → **Create key**. Name it `terramavuno-dev`.
3. Copy the `sk-ant-...` value immediately (shown once) into `.env` as `ANTHROPIC_API_KEY=`.
- **Without it:** text chat is dead (`/api/chat` returns an error). The map, layers and voice (if configured) still work.
- **Restriction:** set a monthly spend limit in Console → Settings → Limits. Use a separate key per environment; rotate after the event.

## 2. ElevenLabs (voice) — all SERVER-ONLY

### `ELEVENLABS_API_KEY`
1. **https://elevenlabs.io** → sign in → click your profile (bottom-left) → **API Keys** → **Create API Key**.
2. Scope it to **Conversational AI** only if the scoped-key option is offered.
3. Paste as `ELEVENLABS_API_KEY=`.

### `ELEVENLABS_AGENT_ID`
1. ElevenLabs dashboard → **Conversational AI → Agents** → **Create agent**.
2. Paste the voice-tuned system prompt, and register the **client tools** printed by `node scripts/print-elevenlabs-tools.mjs` (keeps voice and chat schemas identical).
3. Open the agent → copy the **Agent ID** from the agent settings/URL → `ELEVENLABS_AGENT_ID=`.

### `ELEVENLABS_VOICE_ID` (optional)
1. Dashboard → **Voices** → pick a voice → copy its ID → `ELEVENLABS_VOICE_ID=`.
- **Without these:** `GET /api/voice/signed-url` fails, the mic button stays hidden, chat is unaffected. Missing `ELEVENLABS_AGENT_ID` specifically makes the signed-url endpoint 500.
- **Restriction:** the API key never reaches the browser — the client only ever receives a short-lived **signed URL** minted by the server.

## 3. Supabase

### `VITE_SUPABASE_URL` — CLIENT-SAFE
Supabase dashboard → your project (`gxecynujvqmubkezqpgt`) → **Settings → API** → copy **Project URL**.

### `VITE_SUPABASE_PUBLISHABLE_KEY` — CLIENT-EXPOSED (safe by design)
Same page → **Publishable key** (the browser-safe key, formerly "anon"). Safe to expose **only because RLS is enabled on every table** — never weaken RLS to make a query work.

### `SUPABASE_SECRET_KEY` — SERVER-ONLY ⚠️
Same page → **Secret keys** (service_role). This bypasses RLS entirely.
- Never prefix it `VITE_`, never import it in `apps/globe`, never paste it into client code.
- **Without it:** the API provider falls back to bundled JSON after 1.5 s — **the demo still works**, with a `bundled` badge.

### `DATABASE_URL` — SERVER-ONLY
**Settings → Database → Connection string** (URI). Used for migrations/direct access.
- **Without it:** use `npx supabase link --project-ref gxecynujvqmubkezqpgt` + `npx supabase db push` instead.

### ⚠️ PROMINENT: the Supabase PERSONAL ACCESS TOKEN (`sbp_...`)
The PAT from **Account → Access Tokens** is for **local MCP tooling auth ONLY**.
- It must **NEVER** go in `.env`, `.env.example`, any source file, or any commit.
- It is an account-wide credential (all your projects), not a project key.
- **If one has been pasted into a chat, a doc, or a file at any point: treat it as exposed and rotate it now** — Supabase dashboard → Account → Access Tokens → revoke → generate a new one for MCP only.

## 4. `GOOGLE_MAPS_API_KEY` — CLIENT-EXPOSED (by design)

1. **https://console.cloud.google.com** → create/select a project → enable **billing** (photoreal tiles require it; there is a monthly free allotment).
2. **APIs & Services → Library** → search **"Map Tiles API"** → **Enable**. (This exact API — not "Maps JavaScript API" — powers photorealistic 3D tiles.)
3. **APIs & Services → Credentials → Create credentials → API key** → paste as `GOOGLE_MAPS_API_KEY=`.
4. **Restrict it (required):** click the key → **Application restrictions → Websites (HTTP referrers)** → add `http://localhost:4173/*` (and your deployed origin) → **API restrictions → Restrict key → Map Tiles API** only → Save.
- **This key is visible in browser devtools by design** — Cesium must send it with every tile request. This is exactly how God's Eye View documents it. The referrer + API restrictions are what make that acceptable: a stolen key is useless off your origins.
- **Without it:** no photoreal 3D tiles; the imagery chain falls to Cesium ion/Bing, then keyless Esri.

## 5. `VITE_CESIUM_ION_TOKEN` — CLIENT-EXPOSED

1. **https://ion.cesium.com** → sign in → **Access Tokens** → **Create token**.
2. Grant **`assets:read`** scope only (deselect write/list scopes).
3. Under **Allowed URLs**, add `http://localhost:4173` and your deployed origin.
4. Paste as `VITE_CESIUM_ION_TOKEN=`.
- Client-exposed like the Google key; the scope + URL restrictions are the protection.
- **Without it:** no ion imagery/terrain; keyless Esri fallback still boots.

## 6. WhatsApp share (STRETCH) — all SERVER-ONLY

### Evolution API (demo bridge): `EVOLUTION_API_URL`, `EVOLUTION_API_KEY`, `EVOLUTION_INSTANCE_NAME`
From your **own Evolution API deployment** (self-hosted): base URL, the global API key from its config, and the instance name you created when pairing a WhatsApp number.

### WhatsApp Cloud API (official path): `WHATSAPP_CLOUD_ACCESS_TOKEN`, `WHATSAPP_CLOUD_PHONE_NUMBER_ID`, `WHATSAPP_CLOUD_VERIFY_TOKEN`
**https://developers.facebook.com** → create an app → add the **WhatsApp** product → copy the temporary access token and phone number ID from **API Setup**; the verify token is a string you invent for webhook verification.
- **Without any of these:** the Share button is hidden (gated on `GET /api/share/health`). Zero-risk fallback: a `wa.me/?text=` deep link needs no keys at all.

## 7. `VITE_API_URL` — CLIENT-SAFE

Default `http://localhost:8787`, already set in `.env.example`. In dev the Vite proxy handles `/api` anyway; set this only when the API is deployed to a different origin (then also configure CORS on the API).

---

## Final checks

```powershell
npm run dev:api
Invoke-RestMethod http://localhost:8787/health              # API up, env loaded
Invoke-RestMethod http://localhost:8787/api/voice/signed-url # voice tier configured?
```

Hygiene: separate keys for demo vs anything durable; rotate every key that was ever pasted somewhere insecure; spend limits on Anthropic and Google; `.env` is gitignored — verify with `git status` before any commit.

---

## Farmer channel keys (Africa's Talking USSD/SMS)

The USSD/SMS return path is a second product surface sharing this API. Its variables and the security reasoning behind them, carried over from the farmer-channel work:

- [ ] `ANTHROPIC_API_KEY` — Claude reasoning/tool calling; server only.
- [ ] `VITE_SUPABASE_URL` — public project URL.
- [ ] `VITE_SUPABASE_PUBLISHABLE_KEY` — browser-safe publishable key.
- [ ] `SUPABASE_URL` — server-side project URL; falls back to `VITE_SUPABASE_URL`.
- [ ] `SUPABASE_SECRET_KEY` — privileged server tasks only; never expose with `VITE_`. Required for farmer-channel persistence: channel-owned `conversations` have a null `owner_id`, so the ownership policies evaluate to NULL and no non-service role can read or write them. Without this key the channel still runs but reports are held in memory and lost on restart (`GET /health` says which).
- [ ] `DATABASE_URL` — migrations/server database access; server/CI only.
- [ ] `FIELD_REPORT_SALT` — salt for hashing farmer-channel identities; server only. The demo falls back to a development default, which must not be used anywhere real: an unsalted or shared-salt hash of a Kenyan MSISDN is brute-forceable (roughly 10^8 candidate numbers).
- [ ] `CHANNEL_WEBHOOK_TOKEN` — unguessable path segment for the Africa's Talking callbacks; server only. Webhooks return `503` until it is set. **Africa's Talking does not sign its callbacks**, so this token plus an IP allowlist is the entire authentication story — treat it like a password, use 32+ random characters, and rotate it if a callback URL leaks into a screenshot or a support ticket.

- [ ] `VITE_CESIUM_ION_TOKEN` — Cesium ion terrain/imagery. Not needed for OSM + ellipsoid demo.
- [ ] `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID` — synthesized IVR/voice.
- [ ] `AFRICASTALKING_USERNAME`, `AFRICASTALKING_API_KEY`, `AFRICASTALKING_ENV`, `AFRICASTALKING_SHORTCODE`, `AFRICASTALKING_USSD_SERVICE_CODE`, `PUBLIC_API_BASE_URL` — live USSD/SMS. The menu, parsing and webhook handlers run and are tested without these; they only decide whether an outbound SMS actually leaves the building. Sandbox username is the literal string `sandbox`.
- [ ] `EVOLUTION_API_URL`, `EVOLUTION_API_KEY`, `EVOLUTION_INSTANCE_NAME` — demo WhatsApp bridge only.
- [ ] `WHATSAPP_CLOUD_ACCESS_TOKEN`, `WHATSAPP_CLOUD_PHONE_NUMBER_ID`, `WHATSAPP_CLOUD_VERIFY_TOKEN` — official production path.
- [ ] `OPENWEATHER_API_KEY` — optional current weather.
- [ ] `NASA_EARTHDATA_TOKEN` — optional NASA products.
- [ ] `SENTINEL_HUB_CLIENT_ID`, `SENTINEL_HUB_CLIENT_SECRET` — optional satellite processing.
- [ ] `GOOGLE_MAPS_API_KEY` or `MAPBOX_ACCESS_TOKEN` — optional geocoding/alternate map services.
- [ ] `GROQ_API_KEY`, `OPENAI_API_KEY` — optional model paths only if deliberately enabled.
