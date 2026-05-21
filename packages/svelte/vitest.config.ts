import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // jsdom so the SSR guard in initMushi() sees `window` / `document`
    // during the happy-path tests, and so the SSR test can `delete`
    // them to simulate a server-render. Matches the Vue adapter setup.
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
