import { defineConfig } from 'tsup'

export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm'],
  dts: true,
  clean: true,
  target: 'node18',
  sourcemap: true,
  external: ['@mushi-mushi/plugin-sdk'],
})
