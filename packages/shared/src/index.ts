/**
 * @terramavuno/shared — root barrel.
 *
 * ONE import surface for every consumer (services/api today; any future
 * TypeScript workspace tomorrow). Nothing here has I/O or side effects, so it
 * is safe to import from a request handler, a test, or a bundler.
 *
 * Ordering note: the legacy climate-action exports come FIRST and are
 * deliberately kept — services/api/src/app.ts imports `claudeTools` and
 * `simulateClimateAction` from this barrel, and the /api/simulations endpoint
 * and /api/tools response still depend on them.
 */

/* ---- Legacy climate-action surface (do not remove: app.ts imports these) -- */
export * from './simulator.js';
export * from './tool-schemas.js';

/* ---- Deterministic eligibility engine + truth-model types + fixtures ----- */
export * from './eligibility/index.js';

/* ---- Kilimo tool registry (single source of truth for chat AND voice) ---- */
export * from './tools/index.js';

/* ---- Bundled offline dataset (the zero-network demo path) ---------------- */
export * from './data/index.js';
