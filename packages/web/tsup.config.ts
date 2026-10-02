import { defineConfig, type Options } from 'tsup';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pkg = require('./package.json') as { version: string };

/**
 * styles.ts documents its CSS with comments INSIDE the stylesheet template
 * string. No JS minifier touches string contents, so they shipped to every
 * end user (~4 kB gzipped). Strip them at build time; the source keeps them.
 * Every `/*` in that file is a comment (CSS or JS), so the regex is safe there.
 */
const stripWidgetCssComments: NonNullable<Options['esbuildPlugins']>[number] = {
  name: 'strip-widget-css-comments',
  setup(build) {
    build.onLoad({ filter: /[\\/]src[\\/]styles\.ts$/ }, async (args) => ({
      contents: (await readFile(args.path, 'utf8')).replace(/\/\*[\s\S]*?\*\//g, ''),
      loader: 'ts',
    }));
  },
};

export default defineConfig([
  {
    entry: ['src/index.ts', 'src/test-utils.ts', 'src/i18n/index.ts', 'src/otel.ts', 'src/headless.ts'],
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
    esbuildPlugins: [stripWidgetCssComments],
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
    // No map: the CDN serves this file directly (unpkg/jsdelivr fields), and a
    // 1.2 MB map in every tarball is weight nobody debugs a minified loader with.
    sourcemap: false,
    clean: false,
    treeshake: true,
    splitting: false,
    minify: true,
    define: {
      __MUSHI_SDK_VERSION__: JSON.stringify(pkg.version),
    },
    esbuildPlugins: [stripWidgetCssComments],
    external: ['@sentry/browser', '@sentry/react'],
  },
]);
