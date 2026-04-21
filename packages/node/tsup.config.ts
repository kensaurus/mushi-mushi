import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts', 'src/express.ts', 'src/fastify.ts', 'src/hono.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  splitting: false,
  minify: false,
  external: ['express', 'fastify', 'hono'],
})
