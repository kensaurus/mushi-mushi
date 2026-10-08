import { defineConfig } from 'tsup'

// Pass 1: `dist/cli.js`, the npm bin (Node shebang, ESM only).
// Pass 2: `dist/index.{js,d.ts}`, the library entry for programmatic use.
export default defineConfig([
  {
    entry: { cli: 'src/cli.ts' },
    format: ['esm'],
    dts: false,
    clean: true,
    sourcemap: true,
    target: 'node20',
    banner: { js: '#!/usr/bin/env node' },
  },
  {
    entry: { index: 'src/index.ts' },
    format: ['esm'],
    dts: true,
    clean: false,
    sourcemap: true,
    target: 'node20',
  },
])
