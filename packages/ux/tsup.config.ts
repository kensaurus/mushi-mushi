import { defineConfig } from 'tsup'

// Pass 1: `dist/cli.js`, the npm bin (Node shebang, ESM only).
// Pass 2: `dist/index.{js,d.ts}`, the library entry for programmatic use.
// No source maps: the bin runs through `npx`, and like cli and mcp it ships
// none (they were 1 MB of the 1.6 MB package).
export default defineConfig([
  {
    entry: { cli: 'src/cli.ts' },
    format: ['esm'],
    dts: false,
    clean: true,
    sourcemap: false,
    target: 'node20',
    banner: { js: '#!/usr/bin/env node' },
  },
  {
    entry: { index: 'src/index.ts' },
    format: ['esm'],
    dts: true,
    clean: false,
    sourcemap: false,
    target: 'node20',
  },
])
