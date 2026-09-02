# Demo script — ~4 minutes, beat by beat

Rehearse with **text chat as primary**; voice is the flourish. Pre-warm the flight path (Nairobi → Murang'a → Kandara) on venue Wi-Fi before going on stage so tiles are cached.

Presenter setup: `npm run dev:api` and `npm run dev` already running; browser at `http://localhost:4173`; chat panel open; result-card area clear.

---

## Beat 0 — Cold open on the globe (0:00–0:30)

**Do:** App is already booted, slow orbit over the Indian Ocean approaching East Africa. If `GOOGLE_MAPS_API_KEY` is set, let the camera dip into photoreal Nairobi for ~5 seconds on the way (the optional photoreal beat); otherwise skip straight to Kenya at altitude.

**Say:** *"This is TerraMavuno — Kilimo, Nitapata? 'Farming — will I get it?' Kenya subsidises fertilizer for registered smallholders, but the farmer's real question — will I get it, what will I pay, where do I go — is answered today by queueing at a depot and hoping. We answer it before the queue."*

## Beat 1 — Murang'a wards draw (0:30–0:55)

**Do:** Click the Murang'a scene (or type "show me Kandara"). Camera flies to Murang'a; county outline and the six Kandara ward polygons draw with labels: Ng'araria, Muruka, Kagundu-ini, Gaichanjiru, Ithiru, Ruchu. Depot markers appear, coloured by stock status.

**Say:** *"Murang'a county, Kandara constituency — six wards, real boundaries from geoBoundaries, one real NCPB depot and three simulated agro-dealers, clearly labelled simulated. Every fact on this screen carries a tag: who says so, how we know, and when it was last checked."*

## Beat 2 — K-001, the confirmed farmer (0:55–2:00)

**Do:** In chat, type (or speak, if voice is up) the exact utterance:

> **"Nina mbolea ya ruzuku? I'm farmer K-001, registered in Kandara — will I get subsidized fertilizer, what will I pay, and where do I go?"**

Watch the sequence: Claude calls `fly_to_location` (camera settles on Ng'araria ward), fetches the programme (`get_programme`), calls **`evaluate_farmer`** — the deterministic engine, not the model, decides — then `show_result_card`.

**Point at the card and say:** *"**Confirmed.** She's in the register, her ID is linked, two acres is under the five-acre cap, her ward participates, and stock is verified. The engine — a tested, deterministic function — computed **4 bags** at **KES 2,500** each against a market price around **6,500**: that's a saving of KES 16,000. Pick up at **NCPB Sagana Depot**, stock checked this morning at 6 a.m. Every line has an evidence chip — Official, Direct, and a timestamp. Claude didn't decide any of this; Claude explains what the rules engine decided, and cites it."*

**Optional:** hover one evidence chip to show `Official · Direct · checked 2026-09-02T06:00Z`.

## Beat 3 — K-002, missing requirement (2:00–2:30)

**Do:** Type: **"What about farmer K-002 in Muruka?"**

**Say:** *"A confirmed **no** is still a confirmed answer. K-002 is in the register but her national ID was never linked. The card shows exactly which criterion failed — ID linkage — and the next action: visit the ward agricultural office. She finds this out in ten seconds instead of after a day's travel."*

## Beat 4 — K-003, over the cap (2:30–2:50)

**Do:** Type: **"And K-003 in Gaichanjiru?"**

**Say:** *"K-003 farms seven and a half acres — over the programme's five-acre cap. Ineligible, confirmed, with the rule and its source cited. No apologising, no hedging: the published rule is the published rule."*

## Beat 5 — THE SIJUI MOMENT, K-004 (2:50–3:40)

**Do:** Type: **"Check farmer K-004."** Camera moves to Kabati Agrovet; the card renders with the amber **Indicated by published rules** pill.

**Say:** *"Here's the moment we built this product for. K-004 passes every published rule — but his assigned depot is Kabati Agrovet, a simulated dealer whose stock has **never been checked**. Most systems would round that up to 'yes, go'. Ours says, word for word:"*

> **"Rules indicate you qualify, but I cannot verify today's stock at this depot."**

*"'Sijui' — I don't know — said precisely, with what we DO know and what to do next. Honest uncertainty isn't a failure state here; it's the product. A system that admits what it can't verify is the only kind a farmer should trust with a day of travel."*

## Beat 6 — Close (+ stretch) (3:40–4:00)

**Say:** *"Deterministic engine decides, Claude explains and cites, every fact tagged by authority, derivation and freshness — running keyless on bundled data if it has to. This is one programme in one constituency; the same truth model scales to every subsidy, every county."*

**Stretch (only if rehearsed and stable):** click **Share** on K-001's card → WhatsApp message arrives on the presenter's phone; hold the phone up. *"And the answer travels to where farmers actually are."*

---

## Cut-list (when running long or something wobbles)

Cut in this order — the demo stays coherent at every cut line:

1. **Cut the WhatsApp share** (Beat 6 stretch) — end on the sijui line instead. Strongest possible closer anyway.
2. **Cut K-003** (over-cap) — K-002 already shows a confirmed negative.
3. **Cut the photoreal Nairobi beat** — start the orbit at Kenya altitude.
4. **Cut K-002** — go K-001 straight to K-004; you keep confirmed + sijui, the two poles.
5. **Never cut:** K-001 (the happy path) and K-004 (the sijui moment). If only 90 seconds remain, do only those two.

## Fallback order (when something breaks live)

| Failure | Fallback | What you say |
|---|---|---|
| **Voice fails** (no signed URL, latency, mic) | Type the same utterances in chat — it is the same tool layer, rehearsed as primary | "We'll type it — same brain either way." |
| **Supabase fails / offline** | Provider auto-falls back to bundled JSON within 1.5 s; a `bundled` badge appears | Point at the badge: "Even our data layer tells you the truth about itself." |
| **Photoreal tiles fail / no key** | Imagery chain drops to Cesium ion / Esri aerial; polygons and labels carry the look | Say nothing; nobody misses what they never saw. |
| **Chat/API fully dead** | The globe still renders wards, depots and farmers from bundled JSON; narrate the K-001 card from a pre-captured screenshot if needed | "The map is local-first; let me show you the result it produces." |
| **Whole machine dies** | Backup: pre-recorded 60-second screen capture of Beats 2 and 5 on the phone | — |

---

## Optional extension — the farmer channel close

If the audience asks who the reach number actually refers to, this is the feature-phone close from the farmer-channel workstream. Cut it if time is short.

# Six-minute demo script

1. Open `http://localhost:5173`. Point out “Demo data • sourced benchmarks” and the evidence metadata.
2. Select **Makueni**. Toggle rainfall, drought and vegetation; click county dots or use the selector to fly the globe.
3. Switch to the **2D fallback**, demonstrate selection still works, then return to 3D.
4. Press play in TerraTime. Narrate how rainfall, drought and NDVI change from 2020 through 2025; emphasize these are illustrative P0 signals.
5. Compare Makueni with **Nakuru** in the right panel.
6. Keep **KES 10,000,000**, “Reduce drought vulnerability” and three years. Explain the six ranked scenarios and open the assumptions in code/docs if challenged. The full budget is compared per option; figures are not additive and are not procurement estimates.
7. Mention the voice-tool intent in one line: “Fly to Makueni, outline the county, show drought and water assets, replay from 2020, then simulate KES 10 million.”
8. **Close on the farmer channel.** Point at the winning scenario's reach figure and ask who that number refers to. Then dial it.

   With `CHANNEL_WEBHOOK_TOKEN` set (`$t = $env:CHANNEL_WEBHOOK_TOKEN`), walk the real Africa's Talking USSD contract — the same request shape AT posts:

   ```powershell
   $u = "http://localhost:8787/channels/$t/ussd"
   $p = @{ sessionId='demo-1'; serviceCode='*384*1234#'; phoneNumber='+254712345678' }
   Invoke-RestMethod -Method Post -Uri $u -Body ($p + @{ text='' })            # CON  main menu
   Invoke-RestMethod -Method Post -Uri $u -Body ($p + @{ text='2' })           # CON  what are you reporting
   Invoke-RestMethod -Method Post -Uri $u -Body ($p + @{ text='2*1*makueni' }) # END  recorded
   ```

   Three things to name while that runs:
   - **AT replays every keypress in `text`** (`""`, `"2"`, `"2*1*makueni"`), so the menu is a pure function and needs no session store. Show `2*1*zzz*makueni` — a mistyped county re-prompts without losing the branch.
   - The reply is `text/plain` starting `CON` or `END`, and it is **hard-capped at 182 characters**. Over that, the carrier drops the whole screen and the farmer sees nothing.
   - Nothing stored is a phone number. The record is keyed to a salted hash.

   Then the SMS side, both directions:

   ```powershell
   Invoke-RestMethod -Method Post -Uri "http://localhost:8787/channels/$t/sms/inbound" -Body @{ from='+254712345678'; to='12345'; text='REPORT Makueni short rains failed'; id='demo-msg-1' }
   ```

   Finish on the cost point, because it is the one that connects the channel to the money on screen: every advisory is asserted by test to fit **one billed SMS segment across all 47 counties**. A template that quietly spills into a second segment doubles the price of the reach figure in the simulator panel. That is why USSD/SMS is step 7 of the journey — the globe is how the county compares options, the feature phone is how the farmer receives the decision and answers back, and it is the only path in the model that can move a claim's confidence.

   If Supabase is configured, land the point by showing the row rather than asserting it (`GET /health` should say `store: "supabase (service role)"`):

   ```sql
   select e.claim, e.channel, e.verification_status, a.name as county, p.transformation
   from evidence_records e
   left join administrative_areas a on a.id = e.area_id
   left join provenance_events p on p.entity_table = 'evidence_records' and p.entity_id = e.id::text
   where e.source_id = '00000000-0000-0000-0000-000000000003' order by e.created_at desc limit 3;
   ```

   Two things to say over that result: the claim is stored `unverified` and is invisible to a public reader until someone reviews it, and the `conversation_id` linking it to a reporter is withheld from the public column grant — so a verified claim cannot be grouped back to the farmer who sent it.

   Then be explicit about what is *not* done: no verification workflow exists yet, so a field report cannot yet move a claim's confidence. On sandbox credentials no SMS reaches a real handset, and with Supabase unset the store falls back to memory and every response says `persisted: false`.
