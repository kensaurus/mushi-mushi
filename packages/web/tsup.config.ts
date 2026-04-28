import { defineConfig } from 'tsup';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pkg = require('./package.json') as { version: string };

export default defineConfig({
  entry: ['src/index.ts', 'src/test-utils.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  splitting: false,
  minify: false,
  define: {
    __MUSHI_SDK_VERSION__: JSON.stringify(pkg.version),
  },
  external: ['@mushi-mushi/core', '@sentry/browser', '@sentry/react'],
});
