/**
 * Tests for scripts/lib/viz-token-reads.mjs — run with `pnpm test:scripts`.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { vizTokenReads, vizTokensDeclared } from './lib/viz-token-reads.mjs'

const sorted = (set) => [...set].sort()

test('a viz- string in a module that does not use the viz reader is not a token read', () => {
  const src = `
    export const cls = 'viz-panel'
    export function Chart() { return <div className="viz-legend" /> }
  `
  assert.deepEqual(sorted(vizTokenReads(src)), [])
})

test('viz- literals count in modules importing vizTokens', () => {
  const src = `
    import { readVizToken } from '../../lib/vizTokens'
    const LEGEND = [{ token: 'viz-flow-danger' }]
    const dot = readVizToken(dark ? 'viz-node-border-dark' : "viz-node-border-light")
  `
  assert.deepEqual(sorted(vizTokenReads(src)), [
    'flow-danger',
    'node-border-dark',
    'node-border-light',
  ])
})

test('vizTokens.ts itself counts its name maps', () => {
  const src = `const STEP = { pending: 'viz-step-pending' }`
  assert.deepEqual(sorted(vizTokenReads(src)), [])
  assert.deepEqual(sorted(vizTokenReads(src, { isVizReader: true })), ['step-pending'])
})

test('var(--color-viz-*) counts anywhere; a bare mention or a glob does not', () => {
  const src = `
    // See --color-viz-layer-* and --color-viz-git-main in theme-tokens.css.
    const bg = 'var(--color-viz-canvas-bg)'
    const cls = 'focus-visible:stroke-[var( --color-viz-git-focus)]'
  `
  assert.deepEqual(sorted(vizTokenReads(src)), ['canvas-bg', 'git-focus'])
})

test('declarations are names followed by a colon', () => {
  const css = `
    @theme static { --color-viz-neutral: oklch(0.65 0.02 285); --color-viz-layer-ui:oklch(0.7 0.1 240); }
    .x { color: var(--color-viz-not-declared); }
  `
  assert.deepEqual(sorted(vizTokensDeclared(css)), ['layer-ui', 'neutral'])
})

test('admin modules that read viz tokens by name are still seen', () => {
  const files = [
    'apps/admin/src/components/graph/GraphLegend.tsx',
    'apps/admin/src/lib/favicon.ts',
    'apps/admin/src/components/hero-flow/heroFlow.data.ts',
  ]
  for (const file of files) {
    const reads = vizTokenReads(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'))
    assert.ok(reads.size > 0, file)
  }
})
