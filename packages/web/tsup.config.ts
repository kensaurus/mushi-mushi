import { defineConfig, type Options } from 'tsup';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pkg = require('./package.json') as { version: string };

/**
 * styles.ts documents its CSS with comments INSIDE the stylesheet template
 * string, indented for reading. No JS minifier touches string contents, so
 * both shipped to every end user. Strip comments and leading indentation at
 * build time; the source keeps them. Every `/*` in that file is a comment (CSS
 * or JS), and leading whitespace is insignificant in both CSS and JS.
 */
export const stripShippedTemplateWhitespace: NonNullable<Options['esbuildPlugins']>[number] = {
  name: 'strip-shipped-template-whitespace',
  setup(build) {
    // widget-render.ts: its HTML templates ship their indentation too. HTML
    // collapses whitespace runs and none of these templates holds <pre> or
    // non-empty <textarea> text, so only the indentation is dropped there.
    build.onLoad({ filter: /[\\/]src[\\/](styles|widget-render)\.ts$/ }, async (args) => {
      let src = await readFile(args.path, 'utf8');
      if (/styles\.ts$/.test(args.path)) src = src.replace(/\/\*[\s\S]*?\*\//g, '');
      return { contents: src.replace(/\n[ \t]+/g, '\n').replace(/\n{2,}/g, '\n'), loader: 'ts' };
    });
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
    esbuildPlugins: [stripShippedTemplateWhitespace],
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
    esbuildPlugins: [stripShippedTemplateWhitespace],
    external: ['@sentry/browser', '@sentry/react'],
  },
]);
