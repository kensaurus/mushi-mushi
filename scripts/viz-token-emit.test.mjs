/**
 * Tailwind must emit every viz token readVizToken() asks for, even when no
 * utility class uses it, and those reads must not run at import time.
 *
 * Run with `pnpm test:scripts`.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  compileCss,
  findVizEmitProblems,
  moduleScopeReadVizTokenCalls,
  vizTokenNamesInSource,
} from './viz-token-emit.mjs'

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')

function walk(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry.startsWith('.')) continue
    const path = join(dir, entry)
    const info = statSync(path)
    if (info.isDirectory()) walk(path, acc)
    else if (/\.(tsx?|css)$/.test(entry)) acc.push(path)
  }
  return acc
}

test('a module-scope readVizToken() call is caught', () => {
  const hits = moduleScopeReadVizTokenCalls(
    `
      export const STAGE_HEX = { plan: readVizToken('viz-flow-info') }
      const STYLE = \`color: \${readVizToken('accent')}\`
    `,
    'flowTokens.ts',
  )
  assert.deepEqual(hits.map((hit) => hit.line), [2, 3])
})

test('getters, functions, arrows, and JSX are not import-time reads', () => {
  const tsHits = moduleScopeReadVizTokenCalls(
    `
      export function readVizToken(name: string) { return name }
      export const STAGE_HEX = { get plan() { return readVizToken('viz-flow-info') } }
      export function paint() { return readVizToken('viz-neutral') }
      export const later = () => readVizToken('viz-score-ok')
      function log() { const style = \`color: \${readVizToken('accent')}\` }
    `,
    'flowTokens.ts',
  )
  assert.deepEqual(tsHits, [])

  const jsxHits = moduleScopeReadVizTokenCalls(
    `export function Graph() { return <path stroke={readVizToken('viz-graph-muted')} /> }`,
    'Graph.tsx',
  )
  assert.deepEqual(jsxHits, [])
})

test('viz token names include ternary arms and map entries', () => {
  const names = vizTokenNamesInSource(
    `
      const STEP = { pending: 'viz-step-pending' }
      export function color(dark: boolean) {
        return readVizToken(dark ? 'viz-node-bg-dark' : 'viz-node-bg-light')
      }
    `,
    'vizTokens.ts',
  )
  assert.deepEqual(names.sort(), ['viz-node-bg-dark', 'viz-node-bg-light', 'viz-step-pending'])
})

test('a file that never calls readVizToken contributes no token names', () => {
  assert.deepEqual(vizTokenNamesInSource(`const label = 'viz-neutral'`, 'notes.ts'), [])
})

test('@theme static survives a compile with no utilities; a normal @theme colour does not', async () => {
  const css = await compileCss(
    `
      @import "tailwindcss" source(none);
      @theme { --color-rose: oklch(0.72 0.18 0); }
      @theme static { --color-viz-kept: oklch(0.3 0 0); }
    `,
    resolve(ROOT, 'apps/admin/src/styles'),
  )
  assert.match(css, /--color-viz-kept:/)
  assert.equal(css.includes('--color-rose:'), false)
})

test('every viz token read in the admin is emitted, and none are read at import', async () => {
  const files = walk(resolve(ROOT, 'apps/admin/src'))
  const problems = await findVizEmitProblems(ROOT, files)
  assert.deepEqual(problems, [])
})
