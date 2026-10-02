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
      if (/styles\.ts$/.test(args.path)) {
        src = mapTemplateText(src.replace(/\/\*[\s\S]*?\*\//g, ''), minifyCssText);
      }
      return { contents: src.replace(/\n[ \t]+/g, '\n').replace(/\n{2,}/g, '\n'), loader: 'ts' };
    });
  },
};

/** Whitespace-only CSS minification: collapse runs, drop spaces around `{};,>` and after `:`. */
export function minifyCssText(css: string): string {
  return css.replace(/\s+/g, ' ').replace(/ ?([{};,>]) ?/g, '$1').replace(/: /g, ':');
}

/**
 * Apply `fix` to the literal text of every template literal in `src`, leaving
 * `${…}` expressions, strings and `//` comments untouched. A scanner, not a
 * regex, so nested templates inside expressions are handled.
 */
export function mapTemplateText(src: string, fix: (text: string) => string): string {
  let i = 0;
  let out = '';
  const code = (inExpr: boolean): void => {
    let depth = 0;
    while (i < src.length) {
      const c = src[i];
      if (c === '`') { out += c; i++; template(); continue; }
      if (c === '"' || c === "'") {
        let j = i + 1;
        while (j < src.length && src[j] !== c) j += src[j] === '\\' ? 2 : 1;
        out += src.slice(i, j + 1); i = j + 1; continue;
      }
      if (c === '/' && src[i + 1] === '/') {
        const j = src.indexOf('\n', i);
        const end = j === -1 ? src.length : j;
        out += src.slice(i, end); i = end; continue;
      }
      if (inExpr && c === '{') depth++;
      if (inExpr && c === '}') { if (depth === 0) return; depth--; }
      out += c; i++;
    }
  };
  const template = (): void => {
    let text = '';
    while (i < src.length) {
      const c = src[i];
      if (c === '\\') { text += src.slice(i, i + 2); i += 2; continue; }
      if (c === '`') { out += fix(text) + c; i++; return; }
      if (c === '$' && src[i + 1] === '{') {
        out += `${fix(text)}\${`; text = ''; i += 2;
        code(true);
        out += '}'; i++; continue;
      }
      text += c; i++;
    }
  };
  code(false);
  return out;
}

const libraryBase = {
  sourcemap: true,
  treeshake: true,
  minify: false,
  define: {
    __MUSHI_SDK_VERSION__: JSON.stringify(pkg.version),
  },
  esbuildPlugins: [stripShippedTemplateWhitespace],
  external: ['@mushi-mushi/core', '@sentry/browser', '@sentry/react'],
} satisfies Options;

export default defineConfig([
  // ESM main entry, built ALONE with splitting so the only chunks are its
  // dynamic import()s (screenshot markup, tab-share capture) — loaded when a
  // reporter uses them. Built alone because splitting across several entries
  // would also hoist their shared code into chunks.
  {
    ...libraryBase,
    entry: { index: 'src/index.ts' },
    format: ['esm'],
    dts: true,
    clean: true,
    splitting: true,
    esbuildOptions(options) {
      options.chunkNames = 'chunks/[name]-[hash]';
    },
  },
  {
    ...libraryBase,
    entry: ['src/test-utils.ts', 'src/i18n/index.ts', 'src/otel.ts', 'src/headless.ts'],
    format: ['esm'],
    dts: true,
    clean: false,
    splitting: false,
  },
  // CJS keeps one self-contained file per entry (dynamic imports inlined).
  {
    ...libraryBase,
    entry: ['src/index.ts', 'src/test-utils.ts', 'src/i18n/index.ts', 'src/otel.ts', 'src/headless.ts'],
    format: ['cjs'],
    dts: true,
    clean: false,
    splitting: false,
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
