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
import { readFileSync } from 'node:fs'
import {
  compileThemeCss,
  missingEmittedVizTokens,
  moduleScopeReadVizTokenCalls,
  moduleScopeReadVizTokenHits,
  resolveTailwindNodeEntry,
  shouldRunVizEmissionCheck,
  vizTokenNamesInAdmin,
  vizTokenNamesInSource,
  vizTokensMissingFromCss,
} from './viz-token-emission.mjs'

const base = resolve(dirname(fileURLToPath(import.meta.url)), '../apps/admin')

test('scanner reads readVizToken and vizColorMap arguments, not every viz- string', () => {
  const src = [
    "readVizToken('viz-node-bg-dark')",
    'readVizToken(dark ? "viz-edge-dark" : \'viz-edge-light\')',
    "// readVizToken('viz-not-real')",
    "/* 'viz-also-not' */",
    'const x = `viz-graph-muted`',
    '<div data-testid="viz-panel" className="viz-fragment" />',
    "vizColorMap({ edge: 'viz-minimap-border' })",
    "const STEP = { passed: 'viz-step-passed' }",
    "function color(status: string) {",
    "  const key = STEP[status] ?? 'viz-step-pending'",
    '  return readVizToken(key)',
    '}',
    "const rows = [{ token: 'viz-flow-danger', id: 'viz-row' }]",
    'rows.map((row) => readVizToken(row.token))',
  ].join('\n')
  assert.deepEqual(vizTokenNamesInSource(src), [
    'viz-edge-dark',
    'viz-edge-light',
    'viz-flow-danger',
    'viz-minimap-border',
    'viz-node-bg-dark',
    'viz-step-passed',
    'viz-step-pending',
  ])
})

test('admin scan still sees tokens that are only named in lookup tables', () => {
  const names = vizTokenNamesInAdmin()
  for (const name of ['viz-step-passed', 'viz-step-skipped', 'viz-lang-go', 'viz-lang-typescript', 'viz-lang-rust']) {
    assert.ok(names.includes(name), name)
  }
})

test('pre-commit skips the viz compile unless css or admin source changed', () => {
  assert.equal(
    shouldRunVizEmissionCheck({
      preCommit: true,
      changedPaths: ['packages/server/src/index.ts', 'README.md'],
    }),
    false,
  )
  assert.equal(
    shouldRunVizEmissionCheck({
      preCommit: true,
      changedPaths: ['apps/admin/src/styles/theme-tokens.css'],
    }),
    true,
  )
  assert.equal(
    shouldRunVizEmissionCheck({
      preCommit: true,
      changedPaths: ['apps/admin/src/lib/vizTokens.ts'],
    }),
    true,
  )
  assert.equal(
    shouldRunVizEmissionCheck({
      preCommit: true,
      changedPaths: ['apps/admin/src/pages/GraphPage.tsx'],
    }),
    true,
  )
  assert.equal(shouldRunVizEmissionCheck({ preCommit: false, changedPaths: ['README.md'] }), true)
  assert.equal(shouldRunVizEmissionCheck({ preCommit: true, changedPaths: null }), true)
  assert.equal(shouldRunVizEmissionCheck({ preCommit: true, changedPaths: [] }), false)

  const check = readFileSync(new URL('./check-design-tokens.mjs', import.meta.url), 'utf8')
  assert.match(check, /shouldRunVizEmissionCheck/)
  assert.match(check, /--pre-commit/)
  const hook = readFileSync(new URL('./install-git-hooks.mjs', import.meta.url), 'utf8')
  assert.match(hook, /check-design-tokens\.mjs --pre-commit/)
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
