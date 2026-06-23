import { defineConfig } from 'tsup';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pkg = require('./package.json') as { version: string };

export default defineConfig([
  {
    entry: ['src/index.ts', 'src/test-utils.ts', 'src/i18n/index.ts'],
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
  },
  // Universal loader: a self-initializing IIFE for the "no build step"
  // <script> tag install path. Bundles @mushi-mushi/core in (NOT external) so
  // a single CDN file runs standalone in any browser. Minified for CDN size.
  {
    entry: { 'mushi.loader': 'src/loader.ts' },
    format: ['iife'],
    globalName: 'MushiLoader',
    dts: false,
    sourcemap: true,
    clean: false,
    treeshake: true,
    splitting: false,
    minify: true,
    define: {
      __MUSHI_SDK_VERSION__: JSON.stringify(pkg.version),
    },
    external: ['@sentry/browser', '@sentry/react'],
  },
]);
