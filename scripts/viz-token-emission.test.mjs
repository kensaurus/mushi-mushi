/**
 * FILE: scripts/viz-token-emission.test.mjs
 * PURPOSE: The viz-token scanner, and proof that Tailwind v4 drops an unused
 *          @theme colour unless the block is @theme static.
 * USAGE: node --test scripts/viz-token-emission.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  compileThemeCss,
  missingEmittedVizTokens,
  moduleScopeReadVizTokenCalls,
  moduleScopeReadVizTokenHits,
  resolveTailwindNodeEntry,
  vizTokenNamesInSource,
  vizTokensMissingFromCss,
} from './viz-token-emission.mjs'

const base = resolve(dirname(fileURLToPath(import.meta.url)), '../apps/admin')

test('scanner finds quoted viz tokens and skips comments', () => {
  const src = [
    "readVizToken('viz-node-bg-dark')",
    'readVizToken(dark ? "viz-edge-dark" : \'viz-edge-light\')',
    "// readVizToken('viz-not-real')",
    "/* 'viz-also-not' */",
    'const x = `viz-graph-muted`',
  ].join('\n')
  assert.deepEqual(vizTokenNamesInSource(src), [
    'viz-edge-dark',
    'viz-edge-light',
    'viz-graph-muted',
    'viz-node-bg-dark',
  ])
})

test('missing helper reports tokens absent from css', () => {
  assert.deepEqual(
    vizTokensMissingFromCss(['viz-node-bg-dark', 'viz-edge-dark'], ':root { --color-viz-edge-dark: red; }'),
    ['viz-node-bg-dark'],
  )
})

test('@theme drops an unused viz colour and @theme static keeps it', async () => {
  const dropped = await compileThemeCss(
    '@import "tailwindcss" source(none);\n@theme { --color-viz-node-bg-dark: oklch(0.19 0.007 265); }',
    base,
  )
  assert.equal(dropped.includes('--color-viz-node-bg-dark:'), false)
  const kept = await compileThemeCss(
    '@import "tailwindcss" source(none);\n@theme static { --color-viz-node-bg-dark: oklch(0.19 0.007 265); }',
    base,
  )
  assert.equal(kept.includes('--color-viz-node-bg-dark:'), true)
})

test('every viz token read in admin source is in the compiled theme', async () => {
  assert.deepEqual(await missingEmittedVizTokens(), [])
})

test('@tailwindcss/node resolves from the admin package', () => {
  const entry = resolveTailwindNodeEntry()
  assert.match(entry, /@tailwindcss[/+]node/)
})

test('a missing @tailwindcss/node names the admin devDependency', () => {
  assert.throws(
    () =>
      resolveTailwindNodeEntry(() => {
        const error = new Error("Cannot find module '@tailwindcss/node'")
        error.code = 'MODULE_NOT_FOUND'
        throw error
      }),
    (error) => {
      assert.match(error.message, /direct devDependency/)
      assert.match(error.message, /@tailwindcss\/node/)
      assert.match(error.message, /pnpm install/)
      assert.match(error.message, /@tailwindcss\/vite/)
      return true
    },
  )
})

test('flags module-scope readVizToken calls and allows paint-time reads', () => {
  const src = [
    "const STYLE = `color: ${readVizToken('accent')}`",
    "function paint() { return readVizToken('viz-neutral') }",
    "export const layers = { get ui() { return readVizToken('viz-layer-ui') } }",
    "export const frozen = { color: readVizToken('viz-flow-info') }",
    'class Node {',
    "  color = readVizToken('viz-graph-muted')",
    "  static lane = readVizToken('viz-git-main')",
    '}',
    "export function Icon() { return <path stroke={readVizToken('viz-git-branch')} /> }",
  ].join('\n')
  assert.deepEqual(
    moduleScopeReadVizTokenCalls('sample.tsx', src).map((hit) => hit.line),
    [1, 4, 7],
  )
})

test('admin source does not call readVizToken at module scope', () => {
  assert.deepEqual(moduleScopeReadVizTokenHits(), [])
})
