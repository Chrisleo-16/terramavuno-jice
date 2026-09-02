import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    env: {
      // Tests must never touch the live Supabase project: results would depend
      // on whoever last ran a seed, and CI has no credentials. Blanking these
      // forces every suite down the deterministic path — bundled snapshot for
      // the Kilimo provider, in-memory store for the farmer channel — which is
      // also the path the keyless demo uses.
      SUPABASE_URL: '',
      VITE_SUPABASE_URL: '',
      SUPABASE_SECRET_KEY: '',
      // The provider's real budget (6 s) is tuned for a cold remote project;
      // the timeout-fallback test only needs enough to prove the abort fires.
      SUPABASE_TIMEOUT_MS: '250',
    },
  },
});
