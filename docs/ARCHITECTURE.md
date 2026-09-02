# Architecture

```text
Browser (React/Vite)
  ├─ Cesium agriculture globe / SVG 2D fallback
  ├─ TerraTime state + evidence labels
  └─ Climate simulator UI
          │ HTTP
API (Express/TypeScript)
  ├─ validated simulator endpoint
  ├─ Claude tool definitions
  └─ future channel/provider adapters
          │ server credentials only
Supabase (Postgres + PostGIS + Auth + Storage)
  ├─ geography + time-series observations
  ├─ budgets/interventions/simulations/programmes/assets
  └─ evidence, audit and provenance
```

`packages/shared` is the single source of truth for deterministic simulation logic and Claude tool schemas. Provider adapters should normalize incoming records into `data_sources`, `observations` and `provenance_events`. The UI never receives Supabase secret/service credentials. Public reference tables use narrow read grants plus RLS; user-owned data uses ownership policies.

The interface borrows general interaction ideas from God’s Eye View—fly-to, layers, temporal replay, terrain, route/distance, nearby entities and voice tools—but the implementation and visual language are agriculture-focused. AGRION is architecture-only because its cloned source has no explicit license.

