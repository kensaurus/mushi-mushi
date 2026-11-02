import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/cli.ts', 'src/index.ts'],
  format: ['esm'],
  dts: true,
  // Run through `npx` in CI on every job; like cli and mcp it ships no maps
  // (scripts/check-install-size.mjs treats a shipped map as a regression).
  sourcemap: false,
  clean: true,
  target: 'node20',
})
