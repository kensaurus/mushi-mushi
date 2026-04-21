import { defineConfig } from 'tsup'

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/datadog.ts',
    'src/honeycomb.ts',
    'src/new-relic.ts',
    'src/grafana-loki.ts',
  ],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  splitting: false,
  target: 'node18',
})
