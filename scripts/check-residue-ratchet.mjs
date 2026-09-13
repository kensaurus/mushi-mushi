#!/usr/bin/env node
/**
 * FILE: scripts/check-residue-ratchet.mjs
 * PURPOSE: Ratchet on debug residue and suppression debt in the product
 *          source (non-test). Counts are call/marker counts, so a file that
 *          has three `console.log(` lines contributes three. The maxima are
 *          the measured baseline from docs/execplans/dead-code-voice-agent-loop.md
 *          (A0, 2026-09-12); lower them as residue is paid down, never raise
 *          them to make a red run green.
 *
 *   pnpm check:residue            # exit 1 when any metric exceeds its max
 *   pnpm check:residue -- --list  # also print every match as file:line
 *
 * Scope: packages/{core,web,mcp,cli}/src + apps/admin/src, excluding tests
 * (*.test.*, *.spec.*, __tests__/, e2e/, test/, tests/).
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const LIST = process.argv.includes('--list')

const SCOPE = [
  'packages/core/src',
  'packages/web/src',
  'packages/mcp/src',
  'packages/cli/src',
  'apps/admin/src',
]

const SOURCE_EXT = /\.(ts|tsx|js|jsx|mts|cts|mjs|cjs)$/
const TEST_FILE = /\.(test|spec)\.[^/]+$/
const TEST_DIR = /(^|\/)(__tests__|e2e|test|tests)\//

/**
 * @typedef {{ id: string, label: string, pattern: RegExp, max: number, exclude?: (rel: string) => boolean }} Metric
 */

/** @type {Metric[]} */
const METRICS = [
  {
    id: 'console',
    label: 'console.(log|debug|warn)( outside packages/cli',
    pattern: /console\.(log|debug|warn)\(/g,
    max: 21,
    exclude: (rel) => rel.startsWith('packages/cli/'),
  },
  {
    id: 'ts-suppress',
    label: '@ts-ignore + @ts-expect-error',
    pattern: /@ts-(ignore|expect-error)\b/g,
    max: 1,
  },
  {
    id: 'eslint-disable',
    label: 'eslint-disable',
    pattern: /eslint-disable/g,
    max: 21,
  },
  {
    id: 'any',
    label: ': any | as any',
    pattern: /:\s*any\b|\bas any\b/g,
    max: 9,
  },
]

function walk(dir, out) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist') continue
    const abs = join(dir, name)
    const st = statSync(abs)
    if (st.isDirectory()) walk(abs, out)
    else if (SOURCE_EXT.test(name)) out.push(abs)
  }
  return out
}

function toRel(abs) {
  return relative(ROOT, abs).split(sep).join('/')
}

const files = []
for (const scope of SCOPE) {
  const abs = join(ROOT, scope)
  try {
    statSync(abs)
  } catch {
    console.error(`✗ residue: scope directory missing: ${scope}`)
    process.exit(2)
  }
  walk(abs, files)
}

const inScope = files
  .map((abs) => ({ abs, rel: toRel(abs) }))
  .filter(({ rel }) => !TEST_FILE.test(rel) && !TEST_DIR.test(rel))

/** @type {Map<string, { count: number, hits: string[] }>} */
const results = new Map(METRICS.map((m) => [m.id, { count: 0, hits: [] }]))

for (const { abs, rel } of inScope) {
  const text = readFileSync(abs, 'utf8')
  for (const metric of METRICS) {
    if (metric.exclude?.(rel)) continue
    metric.pattern.lastIndex = 0
    let match
    while ((match = metric.pattern.exec(text))) {
      const line = text.slice(0, match.index).split('\n').length
      const entry = results.get(metric.id)
      entry.count += 1
      if (LIST) entry.hits.push(`${rel}:${line}`)
    }
  }
}

let failed = false
const rows = METRICS.map((metric) => {
  const { count } = results.get(metric.id)
  const over = count > metric.max
  if (over) failed = true
  return { metric: metric.label, current: count, max: metric.max, status: over ? 'OVER' : 'ok' }
})

console.log(`residue ratchet (${inScope.length} non-test files in scope)`)
for (const row of rows) {
  const flag = row.status === 'OVER' ? '✗' : '✓'
  console.log(`  ${flag} ${row.metric.padEnd(44)} ${String(row.current).padStart(4)} / max ${row.max}`)
}

if (LIST) {
  for (const metric of METRICS) {
    const { hits } = results.get(metric.id)
    if (hits.length === 0) continue
    console.log(`\n${metric.label}:`)
    for (const hit of hits) console.log(`  ${hit}`)
  }
}

if (failed) {
  console.error(
    '\n✗ residue ratchet exceeded. Remove the new residue (or the debt it replaced); do not raise the max.',
  )
  process.exit(1)
}
console.log('\n✓ residue ratchet within limits')
