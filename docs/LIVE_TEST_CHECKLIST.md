# Live test checklist

Manual pass before a demo or a submission. The automated half is
`node scripts/live-test.mjs` — run that first, then walk the browser steps it
cannot see.

---

## 0. Start the stack

Two terminals, from the repo root:

```powershell
npm run dev:api      # Terminal 1 — API on http://localhost:8787
npm run dev          # Terminal 2 — globe on http://localhost:4173
```

Open **http://localhost:4173**.

> If the globe looks stale after a code change, hard-reload with **Ctrl+F5**.
> Cesium caches tiles and workers aggressively.

---

## 1. Automated smoke test

```powershell
node scripts/live-test.mjs           # API, engine, channels, chat, voice
node scripts/live-test.mjs --globe   # the above + a headless browser boot
```

- [ ] Exit code 0, no red `FAIL` rows.
- [ ] `dataMode=supabase` in the summary line — if it says `bundled`, Supabase
      timed out. The demo still works, but say so rather than being surprised.
- [ ] `SKIP` rows are only ever the optional keys (`ANTHROPIC_API_KEY`,
      ElevenLabs). Anything else skipping is a real gap.

A `FAIL` here is a blocker. Fix it before touching the browser steps.

---

## 2. Opening flight

Reload the page and watch without touching the mouse.

- [ ] Camera starts far out and flies in to frame **the whole of Kenya**.
- [ ] It **holds on Kenya for ~3.5 s** — long enough to read the national
      picture. It must not smear straight through to Murang'a.
- [ ] Loader reads *"Framing Kenya…"* during the hold.
- [ ] It then descends to **Murang'a / Kandara** and settles at ~30 km.
- [ ] Loader switches to *"Flying to Murang'a, Kenya…"* on the descent.
- [ ] Reload and **drag the globe during the Kenya hold** — the scripted
      descent abandons itself and leaves the camera where you put it. It must
      not yank the view back.

---

## 3. Map layers

Open the **LAYERS** panel.

- [ ] Five Kenya layers present: **wards, programme, prices, depots, farmers**.
- [ ] Each toggles off and back on without a console error.
- [ ] Ward boundaries trace the six Kandara wards.
- [ ] Depot pins sit on land, not in the ocean or at (0,0).
- [ ] Clicking a ward and a depot each opens a readout.

---

## 4. The five farmer verdicts

The heart of the demo. Ask the assistant, or hit
`POST /api/evaluate` with each token.

| Token | Expected conclusion | Eligible | What to look for |
|---|---|---|---|
| `K-001` | `confirmed` | ✅ true | **4 bags**, KES 2,500/bag, savings shown, NCPB Sagana depot |
| `K-002` | `confirmed` | ❌ false | Names the missing requirement: **national ID not linked** |
| `K-003` | `confirmed` | ❌ false | Refused on the **5-acre cap** (7.5 acres), not on a guess |
| `K-004` | `indicated_by_published_rules` | ✅ true | Hedged — depot stock is **unknown** |
| `K-005` | `cannot_determine` | — null | The **"sijui"** case: says it does not know |

- [ ] Every verdict matches the table.
- [ ] Every line of every result card carries a **named, dated citation**.
- [ ] `K-005` genuinely refuses. If it invents an answer, stop — that is the
      one failure the whole project is arguing against.
- [ ] Result cards are labelled **SIMULATED** — the farmer rows are synthetic.

---

## 5. Chat

> Requires `ANTHROPIC_API_KEY` in `.env`. Without it the panel returns a clean
> `chat_unavailable` message and everything else keeps working.

- [ ] *"Am I eligible? My token is K-001"* → the confirmed answer with citations.
- [ ] *"Nitapata mbolea?"* → answers in Kiswahili.
- [ ] *"How many bags will I get?"* as a follow-up → keeps the farmer in context.
- [ ] Ask about a county with no data → says it does not know, does not invent.
- [ ] The map reacts to the conversation (fly-to / outline), not just the text.

---

## 6. Voice

> Requires `ELEVENLABS_API_KEY` + `ELEVENLABS_AGENT_ID`. The mic button is
> **hidden by design** when they are unset.

- [ ] Mic button visible and enabled.
- [ ] Clicking it connects without a console error.
- [ ] Spoken *"Will I get fertilizer?"* returns a spoken answer.
- [ ] Voice drives the same map actions as chat.

---

## 7. Farmer channel (USSD / SMS)

No phone needed — `scripts/live-test.mjs` covers these, but to drive by hand:

```powershell
$t = (Select-String -Path .env -Pattern '^CHANNEL_WEBHOOK_TOKEN=').Line -replace '^CHANNEL_WEBHOOK_TOKEN=',''

# USSD root menu
Invoke-RestMethod -Method Post -Uri "http://localhost:8787/channels/$t/ussd" `
  -Body @{ sessionId='demo-1'; phoneNumber='+254700000001'; serviceCode='*384#'; text='' }

# Inbound SMS
Invoke-RestMethod -Method Post -Uri "http://localhost:8787/channels/$t/sms/inbound" `
  -Body @{ from='+254700000001'; to='12345'; text='K-001'; id='m1'; date=(Get-Date -Format o) }
```

- [ ] USSD replies with a `CON ` prefix and stays **under 182 characters**.
- [ ] Menu selections advance the session.
- [ ] SMS always returns **HTTP 200** — anything else and Africa's Talking retries.
- [ ] `STOP` opts out; the caller then gets **silence**, including for advisories
      triggered from USSD.
- [ ] `START` resumes.
- [ ] Re-posting the **same message id** does not file a second report or bill a
      second ack (provider-retry idempotency).
- [ ] A wrong webhook token is rejected.

---

## 8. Provenance and privacy

Non-negotiable — these are the claims the submission rests on.

- [ ] Field reports come back `classification: community`,
      `verification_status: unverified`, and carry the disclaimer.
- [ ] A raw phone number as `session_ref` is **refused** (HTTP 400).
- [ ] `reporter_ref` is a salted hash, never an MSISDN.
- [ ] Community reports are never presented as official evidence.
- [ ] Kill the network to Supabase → the badge flips to `dataMode: bundled` and
      the demo keeps answering from bundled JSON.

---

## 9. Repo health

```powershell
npm run typecheck        # clean
npm test                 # 101 passing
npm run build            # succeeds
npm run validate:data    # "Bundled dataset OK."
```

- [ ] All four green.
- [ ] Browser console has no unexpected errors. The only acceptable one is the
      `/api/chat` abort when `ANTHROPIC_API_KEY` is unset.

---

## Known-acceptable states

Do not treat these as bugs:

| What you see | Why |
|---|---|
| Plain imagery, no photoreal 3D | Keyless mode. Esri World Imagery is the fallback without `GOOGLE_MAPS_API_KEY` / `VITE_CESIUM_ION_TOKEN`. |
| Mic button missing | `ELEVENLABS_*` unset. Deliberate. |
| Chat returns `chat_unavailable` | `ANTHROPIC_API_KEY` unset. The engine, map and channels are unaffected. |
| `dataMode: bundled` | Supabase hit its 1.5 s timeout. Fully functional fallback. |
| `K-005` answers "sijui" | **Correct.** That is the designed behaviour, not a gap. |
