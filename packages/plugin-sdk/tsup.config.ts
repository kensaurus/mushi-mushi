import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    express: 'src/express.ts',
    hono: 'src/hono.ts',
    'dev-cli': 'src/dev-cli.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  target: 'node18',
  external: ['express', 'hono', 'node:crypto'],
})
