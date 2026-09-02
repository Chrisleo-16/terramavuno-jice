# Risk and provenance policy

- **Decision risk:** simulator outputs are scenarios, not allocation advice. Human approval and official procurement/cost validation are mandatory.
- **False precision:** show ranges in production; P0 scores are illustrative indices. Never mix index values with percentages without a unit label.
- **Beneficiary overlap:** blended options may double-count. The UI and stored unknowns must say so.
- **Temporal leakage:** distinguish observation time, validity period and ingestion time.
- **Licensing:** no redistribution until dataset and tile/model terms are recorded. AGRION code is not copied without a license grant.
- **Privacy:** minimize farmer PII; hash operational identifiers where practical; keep phone numbers out of analytics events.
- **Security:** service/secret keys remain server-side. RLS is enabled on all public tables; public grants are read-only and intentional.
- **Bias/coverage:** confidence must decrease when geography, freshness or sample coverage is weak. Missing data is not zero.

Every production claim must link to a `data_sources` row and, when transformed, a `provenance_events` record containing input/output hashes and a human-readable transformation. Conflicting sources should be retained, not silently overwritten.

