import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.ts'],
    // Vitest defaults to 5s per test. `api-client.test.ts > retries on 5xx
    // errors` exercises the real retry path, so it genuinely sleeps through
    // `getBackoffDelay()` rather than faking timers. That fits easily in 5s
    // when this package runs alone, but `turbo run test` starts a vitest
    // instance per workspace and the sleep plus jsdom setup overshot the
    // default under CPU starvation — the suite failed roughly one full run in
    // two, always on that one test, always passing in isolation. 30s is far
    // above anything here legitimately needs, so a genuinely hung test still
    // fails; it just stops reporting scheduler contention as a test failure.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
