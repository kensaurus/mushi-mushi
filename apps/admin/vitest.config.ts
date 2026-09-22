import { defineConfig } from 'vitest/config'

// Admin tests are intentionally small and focused on pure logic — the rule
// engines that drive NBA / PageHero, formatters, and helpers. UI-level
// behaviour lives in the Playwright dogfood suite under examples/e2e-dogfood
// where the full Supabase + Edge Functions stack is available. Keeping the
// admin's vitest surface narrow keeps the unit tests fast (< 1s) and avoids
// us re-implementing a second integration harness here.
export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    // These tests run in ~1 s each on an idle machine, but `turbo run test`
    // starts a vitest per workspace and under that contention apiFetchScope
    // and validators were measured past the 5 s default. 30 s is far above
    // anything here, so a genuinely hung test still fails.
    //
    // This covers CPU starvation only. The knock-on failure it used to hide —
    // a request left in flight by a timed-out test resolving against the next
    // test's fetch mock — is fixed at the source in apiFetchScope.test.ts,
    // which now matches each assertion to its own request instead of reading
    // `mock.calls[0]`. Raising a timeout never fixes cross-test state.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})
