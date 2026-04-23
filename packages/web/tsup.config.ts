import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/test-utils.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  splitting: false,
  minify: false,
  external: ['@mushi-mushi/core', '@sentry/browser', '@sentry/react'],
});
