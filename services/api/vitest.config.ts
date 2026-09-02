import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The provider's real timeout budget (6 s) is tuned for a cold remote
    // Supabase project. Tests exercise the SAME code path with a small budget
    // so the timeout-fallback case stays fast.
    env: { SUPABASE_TIMEOUT_MS: '250' },
  },
});
