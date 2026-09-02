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

