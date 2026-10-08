import { defineConfig } from 'vitest/config'

// Browser-driven suites (`*.browser.test.ts`) launch Chromium and only run
// with MUSHI_UX_BROWSER_TESTS=1, so the default `pnpm test` stays pure and CI
// needs no browser download.
const browser = process.env.MUSHI_UX_BROWSER_TESTS === '1'

export default defineConfig({
  test: {
    globals: true,
    include: ['src/**/*.test.ts'],
    exclude: browser ? [] : ['src/**/*.browser.test.ts'],
    testTimeout: browser ? 60_000 : 5_000,
  },
})
