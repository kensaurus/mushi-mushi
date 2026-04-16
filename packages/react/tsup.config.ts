import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  splitting: false,
  minify: false,
  external: ['@mushi-mushi/core', '@mushi-mushi/web', 'react', 'react-dom', '@sentry/react', '@sentry/browser'],
  esbuildOptions(options) {
    options.jsx = 'automatic';
  },
});
