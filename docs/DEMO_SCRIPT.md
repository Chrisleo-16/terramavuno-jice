# Six-minute demo script

1. Open `http://localhost:5173`. Point out “Demo data • sourced benchmarks” and the evidence metadata.
2. Select **Makueni**. Toggle rainfall, drought and vegetation; click county dots or use the selector to fly the globe.
3. Switch to the **2D fallback**, demonstrate selection still works, then return to 3D.
4. Press play in TerraTime. Narrate how rainfall, drought and NDVI change from 2020 through 2025; emphasize these are illustrative P0 signals.
5. Compare Makueni with **Nakuru** in the right panel.
6. Keep **KES 10,000,000**, “Reduce drought vulnerability” and three years. Explain the six ranked scenarios and open the assumptions in code/docs if challenged. The full budget is compared per option; figures are not additive and are not procurement estimates.
7. Mention the voice-tool intent in one line: “Fly to Makueni, outline the county, show drought and water assets, replay from 2020, then simulate KES 10 million.”
8. **Close on the farmer channel.** Point at the winning scenario's reach figure and ask who that number refers to. Then show the two-way contract:
   - `GET http://localhost:8787/api/tools` — the tool list includes `record_field_report` with `ussd` and `sms` as inbound channels, and `send_report` now accepts `ussd`.
   - Post a field report as if it arrived from a USSD session in Makueni:

     ```powershell
     $r = @{ channel='ussd'; location='Makueni'; observation='Short rains failed, replanted twice'; indicator='rainfall_onset'; confidence='limited'; session_ref='ussd-session-7781' } | ConvertTo-Json
     Invoke-RestMethod -Method Post -Uri http://localhost:8787/api/field-reports -ContentType application/json -Body $r
     ```

   - Read back the response: classification `community`, `verification_status: unverified`, `persisted: false`, and a hashed `reporter_ref` rather than a phone number. Then post the same thing with `session_ref='+254712345678'` and show the 400 — the API refuses a raw MSISDN instead of storing one.

   Say the line plainly: the globe is how the county compares options, the feature phone is how the farmer receives the decision and answers back. That return path is the only thing in the model that can raise or lower confidence in a claim — which is why it is step 7 of the journey and not a later-phase integration. Be explicit that no provider is connected in the demo; this is the contract and the storage, exercised end to end.

