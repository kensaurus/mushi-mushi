import { readFileSync } from 'node:fs'
import { defineConfig } from 'tsup'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8')) as {
  version: string
}

export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm'],
  dts: false,
  clean: true,
  target: 'node20',
  banner: { js: '#!/usr/bin/env node' },
  define: {
    __MUSHI_LAUNCHER_VERSION__: JSON.stringify(pkg.version),
  },
})
