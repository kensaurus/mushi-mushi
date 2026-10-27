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

// Raised 2026-10-03: the release added 24 MCP tools (117 in the catalog, which
// ships its descriptions and schemas) and CLI commands for accounts, spend,
// design, store reviews, recipe, radar, portfolio and releases, so every
// console page has a terminal and editor path. Same file count; the growth is
// that code, measured at mcp 223.3/877.7 kB and cli 176.5/680.4 kB packed/unpacked.
//
// Raised 2026-10-06 (Plan 021): `mushi ux`, `mushi ux-runs` and `mushi portfolio
// groups` give the new UX runs page and project groups their terminal path
// (surface parity). Playwright stays in @mushi-mushi/ux, not here; the growth is
// the command code, measured at cli 185.3/700.4 kB packed/unpacked.
//
// Raised 2026-10-21 (Plan 022, ADR 0033): `mushi runner status/heartbeat/hooks/
// key/add/audit` and `mushi fixes rerun-ci` give the CI runners page and the
// re-run route their terminal path (surface parity), with the runner setup plan
// builder, host probes and job hook scripts. No new dependencies; the growth is
// that code, measured at cli 204.0/776.3 kB packed/unpacked.
//
// Raised 2026-10-22 (Plan 024, ADR 0035): `mushi fixes verify` and `mushi
// verify workflow` give the verified-merge gates and the mushi-verify workflow
// their terminal path (surface parity). No new dependencies; the growth is the
// gate renderer and the workflow writer, measured at cli 205.7/782.1 kB.
//
// Raised 2026-10-22 (Plan 022 Phase 7b, ADR 0037): `mushi runner placement`
// gives "choose where CI runs" its terminal path (surface parity): the
// placement preview, request and status renderers. No new dependencies; the
// growth is that code, measured at cli 211.6/805.2 kB packed/unpacked.
//
// Raised 2026-10-26: `mushi work` registers its run when the agent starts and
// closes it on every exit, and CLI commands get SIGINT/SIGTERM cleanups
// (onInterrupt), so a local run shows in flight on the console and a stop
// never leaves it hanging. No new dependencies; the growth is that code and
// the mushi work changes since 2026-10-22, measured at cli 220.5/837.4 kB.
//
// Raised 2026-10-26 (npm listing housekeep): the docs index the MCP server
// ships (`search_mushi_docs`, one excerpt per docs page) gained the
// @mushi-mushi/ux page and rewritten descriptions for the SDK and plugin
// pages. No code or dependency change; measured at mcp 232.6/921.8 kB, where
// 0.29.1 already published at 920.0 kB unpacked.
//
// Raised 2026-10-27 (ADR 0047, ADR 0048): `mushi runner bill` and `mushi
// runner fix` give the real CI bill and the one-click cost fixes their
// terminal path, and `mushi work --daemon` with `mushi worker install/status/
// revoke` is the local worker the console steers (heartbeat, claims, guards,
// systemd unit and Windows task writers). No new dependencies, 32 files, no
// source maps; the growth is that code, measured at cli 235.5/902.7 kB.
//
// Raised 2026-10-27 (ADR 0049, ADR 0050, ADR 0042 amendment): `mushi work
// --daemon` runs conflicts lanes (merge the base in, check only conflicted
// files changed, push a plain merge) and audit lanes (propose, reproduce with
// a closed check, veto, file), parses claims by kind, and runProc no longer
// hangs on a child holding its pipes. No new dependencies, 32 files, no
// source maps; the growth is that code, measured at cli 249.7/935.6 kB.
export const BUDGETS = [
  { name: '@mushi-mushi/mcp', dir: 'packages/mcp', packed: 240_000, unpacked: 940_000 },
  { name: '@mushi-mushi/cli', dir: 'packages/cli', packed: 255_000, unpacked: 960_000 },
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
