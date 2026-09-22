import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  // esbuild still tree-shakes the bundle. tsup's extra Rollup pass would strip
  // the 'use client' banner below ("Module level directives cause errors when
  // bundled ... was ignored"), so it stays off.
  treeshake: false,
  splitting: false,
  minify: false,
  external: ['@mushi-mushi/core', '@mushi-mushi/web', 'react', 'react-dom', '@sentry/react', '@sentry/browser'],
  // Every export uses context, state or effects, so the whole bundle is a
  // client module. The directive lets Next.js App Router import
  // <MushiProvider> straight into a Server Component layout.
  banner: { js: "'use client';" },
  esbuildOptions(options) {
    options.jsx = 'automatic';
  },
});
