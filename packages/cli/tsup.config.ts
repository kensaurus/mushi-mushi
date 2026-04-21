import { readFileSync } from 'node:fs'
import { defineConfig } from 'tsup'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8')) as {
  version: string
}

const define = {
  __MUSHI_CLI_VERSION__: JSON.stringify(pkg.version),
}

export default defineConfig([
  {
    entry: { index: 'src/index.ts' },
    format: ['esm'],
    dts: false,
    clean: true,
    target: 'node20',
    banner: { js: '#!/usr/bin/env node' },
    define,
  },
  {
    entry: { init: 'src/init.ts', detect: 'src/detect.ts', version: 'src/version.ts' },
    format: ['esm'],
    dts: true,
    clean: false,
    target: 'node20',
    define,
  },
])
