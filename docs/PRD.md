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
- The farmer channel contract exists in P0: `record_field_report` accepts inbound reports from `ussd`/`sms`/`ivr`/`whatsapp`/`web`, `conversations` can hold a session for a caller who has no account, and inbound reports land as `community` classification pending verification. Provider connection is a later phase; the contract and the storage are not.
- No raw phone number is stored. Channel identity is a salted hash, and channel-owned conversations are invisible to `anon`/`authenticated` under RLS.

## Later phases

Live ingestion, official county budget imports, calibrated cost catalogues, voice execution, live Africa's Talking USSD/SMS provider connection plus IVR and WhatsApp adapters, a verification workflow that promotes `community` reports to verified evidence, report export, farmer cases, logistics, site placement and authenticated collaboration. These remain integrations, not claims of P0 completion.

The distinction for the farmer channel: the **contract** (inbound tool, channel-agnostic conversation storage, community classification, hashed identity) is P0. The **provider wiring and the verification workflow** are later. A later-phase provider does not make the channel a later-phase concern.
