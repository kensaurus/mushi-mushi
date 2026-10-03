import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Each test runs in well under a second on an idle machine, but
    // `turbo run test` starts a vitest per workspace, and tests that boot jsdom
    // or do a cold
    // dynamic import were measured past the 5 s default under that contention
    // (web, node and react-native each failed once that way on 2026-10-02 and
    // passed alone). 30 s matches core, server, admin and mcp, and is far above
    // anything here, so a genuinely hung test still fails.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // jsdom so the SSR guard in MushiService sees `window` / `document`
    // during the happy-path tests, and so the SSR test can `delete`
    // them to simulate Angular Universal pre-render.
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
