#!/usr/bin/env node
/**
 * FILE: scripts/check-install-size.mjs
 * PURPOSE: Size budget for the packages people run through `npx`, where every
 *          byte is downloaded on each cold start: @mushi-mushi/mcp (spawned by
 *          the editor) and @mushi-mushi/cli (behind `npx mushi-mushi`).
 *
 * Packs each package with `pnpm pack` (the release's own packer) and fails
 * when the tarball (download) or its unpacked contents (node_modules) exceed
 * the budget. Run after the packages are built.
 *
 * Budgets are the measured size on 2026-09-22 plus ~15%. When a real feature
 * needs more, raise the number in the same PR and say why; do not raise it to
 * make an accidental regression (a bundled dependency, a source map, a test
 * fixture in `files`) pass.
 *
 *   package              measured packed / unpacked     budget packed / unpacked
 *   @mushi-mushi/mcp     190,211 B / 715,773 B (21 f)   220,000 B / 825,000 B
 *   @mushi-mushi/cli     143,155 B / 532,771 B (34 f)   165,000 B / 615,000 B
 *
 * Usage: node scripts/check-install-size.mjs
 */

import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { packPackage, tarballFileSizes } from './lib/pack.mjs'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')

export const BUDGETS = [
  { name: '@mushi-mushi/mcp', dir: 'packages/mcp', packed: 220_000, unpacked: 825_000 },
  { name: '@mushi-mushi/cli', dir: 'packages/cli', packed: 165_000, unpacked: 615_000 },
]

const fmt = (n) => `${(n / 1000).toFixed(1)} kB`

/**
 * @param {{ name: string, packed: number, unpacked: number }} budget
 * @param {{ packed: number, unpacked: number }} actual
 * @returns {string[]} problems
 */
export function overBudget(budget, actual) {
  const problems = []
  for (const key of ['packed', 'unpacked']) {
    if (actual[key] > budget[key]) {
      problems.push(
        `${budget.name}: ${key} size ${fmt(actual[key])} exceeds the ${fmt(budget[key])} budget by ${fmt(actual[key] - budget[key])}`,
      )
    }
  }
  return problems
}

function main() {
  const dest = mkdtempSync(join(tmpdir(), 'mushi-install-size-'))
  const problems = []
  try {
    for (const budget of BUDGETS) {
      const tgz = packPackage(join(ROOT, budget.dir), dest)
      const actual = tarballFileSizes(tgz)
      console.log(
        `${budget.name}: packed ${fmt(actual.packed)} / ${fmt(budget.packed)}, ` +
          `unpacked ${fmt(actual.unpacked)} / ${fmt(budget.unpacked)}, ${actual.files} files`,
      )
      problems.push(...overBudget(budget, actual))
    }
  } finally {
    rmSync(dest, { recursive: true, force: true })
  }
  if (problems.length > 0) {
    console.error('\ncheck-install-size: over budget:')
    for (const p of problems) console.error(`  • ${p}`)
    console.error('\nFind what grew (`pnpm pack` then `tar -tvzf`), or raise the budget in scripts/check-install-size.mjs with a reason.')
    return 1
  }
  console.log('check-install-size: within budget ✓')
  return 0
}

function isEntryScript() {
  if (!process.argv[1]) return false
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return import.meta.url === pathToFileURL(process.argv[1]).href
  }
}

if (isEntryScript()) process.exitCode = main()
