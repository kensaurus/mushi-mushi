import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // jsdom so the SSR guard in MushiService sees `window` / `document`
    // during the happy-path tests, and so the SSR test can `delete`
    // them to simulate Angular Universal pre-render.
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
