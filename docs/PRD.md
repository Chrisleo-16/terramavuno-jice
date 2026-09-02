# Product requirements

## Problem

County teams and agricultural partners need one explainable workspace to understand changing climate/agriculture conditions and compare how a constrained budget might be allocated. Existing information is fragmented across maps, spreadsheets, reports and farmer channels.

The people a county allocation is spent on cannot open a WebGL globe. Without a feature-phone channel the product's reach is limited to officials with laptops, every observation stays top-down, and the farmers who could confirm or contradict a claim have no return path. USSD and SMS are therefore the reach denominator and the ground-truth sensor for this product, not a delivery convenience added after the analysis is finished.

## Primary P0 journey

1. Choose a Kenyan county and a planning year from 2020 onward.
2. Inspect rainfall, drought, NDVI and infrastructure signals with provenance labels.
3. Compare the county with another county.
4. Enter a budget, objective and horizon.
5. Compare irrigation, protected agriculture, water harvesting, climate-smart crops, extension and blended scenarios.
6. Review reach, time, suitability, impact, evidence strength, risks and unknowns.
7. Deliver the chosen scenario to affected farmers over a feature-phone channel (USSD/SMS) and record what comes back — confirmation, contradiction or a field observation — as `community`-classified evidence attached to the same county and time.

Step 7 closes the loop: it is what turns a spending comparison into a measurable intervention. The `extension-support` option in the simulator already prices digital delivery at a KES 10,000 benchmark per farmer reached, so the channel is inside the headline reach number whether or not it is connected.

## P0 acceptance criteria

- The demo starts with no API keys and clearly distinguishes synthetic/benchmark values.
- 3D and 2D map modes both support county selection.
- At least three layers, one county comparison, KES 10M simulation and 2020–2025 playback are demonstrable.
- Simulation output is deterministic, tested and never described as an official estimate.
- Every durable evidence record can identify its source, time, confidence and transformation.
- User-owned records are protected with RLS; secret/service keys never enter browser code.
- The farmer channel runs in P0: the Africa's Talking USSD and inbound-SMS callbacks are implemented and tested, `record_field_report` accepts inbound reports from `ussd`/`sms`/`ivr`/`whatsapp`/`web`, `conversations` can hold a session for a caller who has no account, and inbound reports land as `community` classification pending verification. Live provider credentials change whether an SMS leaves the building, not whether the channel exists.
- No raw phone number is stored, logged or echoed. Channel identity is a salted hash, and channel-owned conversations are invisible to `anon`/`authenticated` under RLS.
- Carrier limits are enforced in code, not hoped for: a USSD reply always fits 182 septets including its `CON`/`END` prefix, and every county advisory fits one billed 160-septet SMS segment.
- Callers can opt out. `STOP` silences the channel for that identity and is honoured by the USSD advisory path too, because consent is keyed to the identity hash rather than to a conversation.
- An accepted report is durable when Supabase is configured: `conversations` + `evidence_records` + a `provenance_events` row carrying input/output hashes and the transformation. A provider retry is deduplicated by unique index, not by hope, and does not bill a second acknowledgement.
- A verified community claim cannot be traced back to its reporter by an anonymous reader: `conversation_id` is withheld from the public column grant on `evidence_records`.

## Later phases

Live ingestion, official county budget imports, calibrated cost catalogues, voice execution, IVR and WhatsApp adapters, per-identity rate limiting on inbound reports, delivery-report persistence, a verification workflow that promotes `community` reports to verified evidence, report export, farmer cases, logistics, site placement and authenticated collaboration. These remain integrations, not claims of P0 completion.

The distinction for the farmer channel: the **USSD menu, SMS grammar, provider client, webhooks and Supabase persistence** are P0 and tested. What is still missing is the **verification workflow** — reports are stored as unverified community evidence and stay invisible to public readers until someone reviews them, so field truth cannot yet actually move a claim's confidence. That review step, not the plumbing, is now the gap between the channel and the impact claim.
