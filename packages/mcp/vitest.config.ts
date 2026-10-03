import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['src/**/*.test.{ts,tsx}'],
    // Integration tests boot a real MCP client + server per test (0.4–3.5s
    // each alone); on a loaded CI runner one went past vitest's 5s default.
    // 30s matches core/server/admin and still fails a genuinely hung test.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
