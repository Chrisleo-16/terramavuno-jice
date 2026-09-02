# API keys checklist

The local P0 demo needs **no third-party secret**. Copy `.env.example` to `.env.local`; `VITE_API_URL` already defaults in the example.

## Required for connected features

- [ ] `ANTHROPIC_API_KEY` — Claude reasoning/tool calling; server only.
- [ ] `VITE_SUPABASE_URL` — public project URL.
- [ ] `VITE_SUPABASE_PUBLISHABLE_KEY` — browser-safe publishable key.
- [ ] `SUPABASE_SECRET_KEY` — privileged server tasks only; never expose with `VITE_`.
- [ ] `DATABASE_URL` — migrations/server database access; server/CI only.
- [ ] `FIELD_REPORT_SALT` — salt for hashing farmer-channel identities; server only. The demo falls back to a development default, which must not be used anywhere real: an unsalted or shared-salt hash of a Kenyan MSISDN is brute-forceable.

## Optional integrations

- [ ] `VITE_CESIUM_ION_TOKEN` — Cesium ion terrain/imagery. Not needed for OSM + ellipsoid demo.
- [ ] `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID` — synthesized IVR/voice.
- [ ] `AFRICASTALKING_USERNAME`, `AFRICASTALKING_API_KEY`, `AFRICASTALKING_SHORTCODE` — USSD/SMS/IVR sandbox or production. The channel contract runs without these; they connect a live provider to it.
- [ ] `EVOLUTION_API_URL`, `EVOLUTION_API_KEY`, `EVOLUTION_INSTANCE_NAME` — demo WhatsApp bridge only.
- [ ] `WHATSAPP_CLOUD_ACCESS_TOKEN`, `WHATSAPP_CLOUD_PHONE_NUMBER_ID`, `WHATSAPP_CLOUD_VERIFY_TOKEN` — official production path.
- [ ] `OPENWEATHER_API_KEY` — optional current weather.
- [ ] `NASA_EARTHDATA_TOKEN` — optional NASA products.
- [ ] `SENTINEL_HUB_CLIENT_ID`, `SENTINEL_HUB_CLIENT_SECRET` — optional satellite processing.
- [ ] `GOOGLE_MAPS_API_KEY` or `MAPBOX_ACCESS_TOKEN` — optional geocoding/alternate map services.
- [ ] `GROQ_API_KEY`, `OPENAI_API_KEY` — optional model paths only if deliberately enabled.

The current TerraMavuno build inherits no required God’s Eye View keys. Keep secrets in local/hosting secret stores, rotate exposed keys, scope provider permissions, and use separate demo/production projects.

