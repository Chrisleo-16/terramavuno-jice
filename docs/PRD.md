# Product requirements

## Problem

County teams and agricultural partners need one explainable workspace to understand changing climate/agriculture conditions and compare how a constrained budget might be allocated. Existing information is fragmented across maps, spreadsheets, reports and farmer channels.

## Primary P0 journey

1. Choose a Kenyan county and a planning year from 2020 onward.
2. Inspect rainfall, drought, NDVI and infrastructure signals with provenance labels.
3. Compare the county with another county.
4. Enter a budget, objective and horizon.
5. Compare irrigation, protected agriculture, water harvesting, climate-smart crops, extension and blended scenarios.
6. Review reach, time, suitability, impact, evidence strength, risks and unknowns.

## P0 acceptance criteria

- The demo starts with no API keys and clearly distinguishes synthetic/benchmark values.
- 3D and 2D map modes both support county selection.
- At least three layers, one county comparison, KES 10M simulation and 2020–2025 playback are demonstrable.
- Simulation output is deterministic, tested and never described as an official estimate.
- Every durable evidence record can identify its source, time, confidence and transformation.
- User-owned records are protected with RLS; secret/service keys never enter browser code.

## Later phases

Live ingestion, official county budget imports, calibrated cost catalogues, voice execution, USSD/SMS/IVR/WhatsApp delivery, report export, farmer cases, logistics, site placement and authenticated collaboration. These remain integrations, not claims of P0 completion.

