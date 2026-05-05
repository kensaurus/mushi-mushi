import { defineConfig } from 'tsup'

// Two-pass build (mirrors @mushi-mushi/cli):
//   Pass 1: `dist/run.js`   — the npm bin. Needs a Node shebang so
//                              `npx mushi-mushi-auth refresh` works on
//                              the installer's $PATH. ESM-only because
//                              the bin is invoked as a script, never
//                              `require()`'d.
//   Pass 2: `dist/index.{js,cjs,d.ts}` — the library entry. ESM + CJS
//                              + types so `import { refresh } from
//                              '@mushi-mushi/inventory-auth-runner'`
//                              works in any host project.
export default defineConfig([
  {
    entry: { run: 'src/run.ts' },
    format: ['esm'],
    dts: false,
    clean: true,
    sourcemap: true,
    target: 'node20',
    banner: { js: '#!/usr/bin/env node' },
  },
  {
    entry: { index: 'src/index.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    clean: false,
    sourcemap: true,
    target: 'node20',
  },
])
