import { defineConfig } from 'tsup'

export default defineConfig({
  entry: { index: 'src/index.ts', server: 'src/server.ts' },
  format: ['esm'],
  dts: true,
  clean: true,
  target: 'node18',
  external: ['@mushi-mushi/plugin-sdk'],
  banner: { js: '#!/usr/bin/env node' },
})
