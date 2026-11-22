import { readFileSync } from 'node:fs'
import { defineConfig, type Options } from 'tsup'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8')) as {
  version: string
}

/**
 * Never bundled into the umbrella: the SDK packages it depends on (so an app
 * that also has @mushi-mushi/web shares one SDK instance) and every framework
 * (optional peers the app brings itself).
 */
const SDK_EXTERNAL: NonNullable<Options['external']> = [
  /^@mushi-mushi\/(core|web|node)(\/.*)?$/,
  'react',
  'react-dom',
  'vue',
  'svelte',
  '@angular/core',
  'express',
  'fastify',
  'hono',
  '@opentelemetry/api',
  '@sentry/browser',
  '@sentry/react',
  'rrweb',
]

/**
 * The framework adapters are devDependencies, bundled into their entry. A
 * regular dependency would make npm 7+ auto-install each adapter's REQUIRED
 * framework peer, so every app would get React, Vue, Svelte and Angular.
 */
const ADAPTERS = /^@mushi-mushi\/(react|vue|svelte|angular)$/

/** The ESLint plugin, bundled into `mushi-mushi/eslint` (no longer published). */
const ESLINT_PLUGIN = /^eslint-plugin-mushi-mushi(\/.*)?$/

const sdk = {
  format: ['esm', 'cjs'],
  target: 'es2022',
  clean: false,
  splitting: false,
  sourcemap: false,
  minify: false,
  external: SDK_EXTERNAL,
} satisfies Options

export default defineConfig([
  // `npx mushi-mushi`: the wizard. Its own entry so importing the package
  // never runs it.
  {
    entry: { bin: 'src/bin.ts' },
    format: ['esm'],
    dts: false,
    clean: true,
    target: 'node20',
    banner: { js: '#!/usr/bin/env node' },
    define: {
      __MUSHI_LAUNCHER_VERSION__: JSON.stringify(pkg.version),
    },
  },
  // Plain re-exports of the SDK packages mushi-mushi depends on.
  {
    ...sdk,
    entry: {
      index: 'src/index.ts',
      core: 'src/core.ts',
      headless: 'src/headless.ts',
      i18n: 'src/i18n.ts',
      otel: 'src/otel.ts',
      'test-utils': 'src/test-utils.ts',
      node: 'src/node.ts',
      'node-express': 'src/node-express.ts',
      'node-fastify': 'src/node-fastify.ts',
      'node-hono': 'src/node-hono.ts',
    },
    dts: true,
  },
  {
    ...sdk,
    entry: { vue: 'src/vue.ts', svelte: 'src/svelte.ts', angular: 'src/angular.ts' },
    noExternal: [ADAPTERS],
    dts: { resolve: [ADAPTERS] },
  },
  // `mushi-mushi/eslint`: the ESLint rules, bundled from the workspace plugin
  // (a devDependency, private since ADR 0060 Phase 1b). eslint is an optional
  // peer and stays external, like the frameworks.
  {
    ...sdk,
    entry: { eslint: 'src/eslint.ts' },
    external: [...SDK_EXTERNAL, /^eslint(\/.*)?$/],
    noExternal: [ESLINT_PLUGIN],
    dts: { resolve: [ESLINT_PLUGIN] },
  },
  // React on its own: every export uses hooks or context, so the entry is a
  // client module. Bundling drops the adapter's own 'use client' directive, so
  // the banner puts it back (Next.js App Router imports <MushiProvider> into a
  // Server Component layout). treeshake stays off as in packages/react: the
  // extra Rollup pass would strip the banner.
  {
    ...sdk,
    entry: { react: 'src/react.ts' },
    noExternal: [ADAPTERS],
    dts: { resolve: [ADAPTERS] },
    treeshake: false,
    banner: { js: "'use client';" },
  },
])
