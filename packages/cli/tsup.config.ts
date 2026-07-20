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
    // @napi-rs/keyring is an optional N-API dep with platform-native .node
    // binaries. We load it via require() at runtime (gracefully if absent),
    // so tsup must not try to bundle or resolve the platform-specific files.
    external: ['@napi-rs/keyring'],
  },
  {
    entry: {
      init: 'src/init.ts',
      detect: 'src/detect.ts',
      version: 'src/version.ts',
      'wizard-args': 'src/wizard-args.ts',
    },
    format: ['esm'],
    dts: true,
    clean: false,
    target: 'node20',
    define,
  },
])
