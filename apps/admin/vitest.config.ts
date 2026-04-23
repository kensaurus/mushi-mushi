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
  },
})
