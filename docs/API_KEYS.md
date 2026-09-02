# API keys checklist

The local P0 demo needs **no third-party secret**. Copy `.env.example` to `.env.local`; `VITE_API_URL` already defaults in the example.

## Required for connected features

- [ ] `ANTHROPIC_API_KEY` — Claude reasoning/tool calling; server only.
- [ ] `VITE_SUPABASE_URL` — public project URL.
- [ ] `VITE_SUPABASE_PUBLISHABLE_KEY` — browser-safe publishable key.
- [ ] `SUPABASE_URL` — server-side project URL; falls back to `VITE_SUPABASE_URL`.
- [ ] `SUPABASE_SECRET_KEY` — privileged server tasks only; never expose with `VITE_`. Required for farmer-channel persistence: channel-owned `conversations` have a null `owner_id`, so the ownership policies evaluate to NULL and no non-service role can read or write them. Without this key the channel still runs but reports are held in memory and lost on restart (`GET /health` says which).
- [ ] `DATABASE_URL` — migrations/server database access; server/CI only.
- [ ] `FIELD_REPORT_SALT` — salt for hashing farmer-channel identities; server only. The demo falls back to a development default, which must not be used anywhere real: an unsalted or shared-salt hash of a Kenyan MSISDN is brute-forceable (roughly 10^8 candidate numbers).
- [ ] `CHANNEL_WEBHOOK_TOKEN` — unguessable path segment for the Africa's Talking callbacks; server only. Webhooks return `503` until it is set. **Africa's Talking does not sign its callbacks**, so this token plus an IP allowlist is the entire authentication story — treat it like a password, use 32+ random characters, and rotate it if a callback URL leaks into a screenshot or a support ticket.

## Optional integrations

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

The current TerraMavuno build inherits no required God’s Eye View keys. Keep secrets in local/hosting secret stores, rotate exposed keys, scope provider permissions, and use separate demo/production projects.

