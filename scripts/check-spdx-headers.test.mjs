/**
 * Tests for scripts/check-spdx-headers.mjs — run with `pnpm test:scripts`.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { distTargets, parseTsupEntries, resolveSource } from './check-spdx-headers.mjs'

test('distTargets collects every JS file the manifest exposes and skips types/css/json', () => {
  const targets = distTargets({
    main: './dist/index.cjs',
    module: './dist/index.js',
    unpkg: './dist/mushi.loader.global.js',
    bin: { 'mushi-mcp': './dist/index.js', other: './dist/cli.js' },
    exports: {
      '.': { import: { types: './dist/index.d.ts', default: './dist/index.js' }, require: './dist/index.cjs' },
      './express': { types: './dist/express.d.cts', import: './dist/express.js' },
      './styles.css': './dist/styles.css',
      './schema.json': './dist/schema.json',
    },
  })
  assert.deepEqual(targets, [
    'dist/cli.js',
    'dist/express.js',
    'dist/index.cjs',
    'dist/index.js',
    'dist/mushi.loader.global.js',
  ])
  assert.deepEqual(distTargets({ bin: './dist/run.js' }), ['dist/run.js'])
})

test('parseTsupEntries names array entries relative to their common directory', () => {
  const entries = parseTsupEntries(
    "defineConfig({ entry: ['src/index.ts', 'src/test-utils.ts', 'src/i18n/index.ts'], format: ['esm'] })",
  )
  assert.deepEqual(Object.fromEntries(entries), {
    index: 'src/index.ts',
    'test-utils': 'src/test-utils.ts',
    'i18n/index': 'src/i18n/index.ts',
  })
})

test('parseTsupEntries reads object entries, quoted or bare keys, across configs', () => {
  const entries = parseTsupEntries(`defineConfig([
    { entry: { index: 'src/index.ts' }, banner: { js: '#!/usr/bin/env node' } },
    { entry: {
        init: 'src/init.ts',
        'wizard-args': 'src/wizard-args.ts',
      } },
    { entry: { 'mushi.loader': 'src/loader.ts' }, format: ['iife'] },
  ])`)
  assert.deepEqual(Object.fromEntries(entries), {
    index: 'src/index.ts',
    init: 'src/init.ts',
    'wizard-args': 'src/wizard-args.ts',
    'mushi.loader': 'src/loader.ts',
  })
})

test('resolveSource maps through tsup, falls back to src/, and flags unbuilt targets', () => {
  const entries = new Map([
    ['index', 'src/index.ts'],
    ['mushi.loader', 'src/loader.ts'],
    ['i18n/index', 'src/i18n/index.ts'],
  ])
  const exists = (rel) => ['src/sentry.ts', 'src/index.ts'].includes(rel)
  assert.deepEqual(resolveSource('dist/mushi.loader.global.js', entries, exists), { source: 'src/loader.ts', built: true })
  assert.deepEqual(resolveSource('dist/i18n/index.cjs', entries, exists), { source: 'src/i18n/index.ts', built: true })
  // Exported and present in src/, but no tsup entry builds it.
  assert.deepEqual(resolveSource('dist/sentry.js', entries, exists), { source: 'src/sentry.ts', built: false })
  // Nothing to check: the gate must fail rather than pass silently.
  assert.deepEqual(resolveSource('dist/missing.js', entries, exists), { source: null, built: false })
  assert.deepEqual(resolveSource('lib/index.js', entries, exists), { source: null, built: false })
  // No tsup config at all: trust the src/ fallback.
  assert.deepEqual(resolveSource('dist/index.js', new Map(), exists), { source: 'src/index.ts', built: true })
})
