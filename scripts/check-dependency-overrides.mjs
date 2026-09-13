#!/usr/bin/env node
/**
 * check-dependency-overrides.mjs
 *
 * Every entry in the root `pnpm.overrides` must be bounded — it has to state a
 * version it will NOT cross.
 *
 * WHY THIS EXISTS
 * ---------------
 * On 2026-09-13 the Release workflow failed at `changeset version` with:
 *
 *     Error: Function yaml.safeLoad is removed in js-yaml 4.
 *       at parse (read-yaml-file@1.1.0/index.js)
 *
 * `read-yaml-file@1.1.0` declares `js-yaml: ^3.6.1` and calls `safeLoad`, a
 * js-yaml 3 API. The override added to clear a security advisory was written
 * `"js-yaml@3": ">=3.15.2"`. That range is open-ended: `>=3.15.2` is satisfied
 * by 4.x and 5.x too, so pnpm resolved 4.3.2 and the API vanished underneath a
 * consumer that never asked to move major.
 *
 * An override written to patch a CVE should raise the floor, never lift the
 * ceiling. `>=X` alone silently opts every consumer into the next breaking
 * change the moment it is published — and because overrides are repo-wide, it
 * does so for packages that were never part of the advisory.
 *
 * WHAT PASSES
 *   "^8.5.18"            caret — bounded by its own major
 *   "~3.1.4"             tilde — bounded by its minor
 *   "1.2.3"              exact
 *   ">=3.15.2 <4"        explicit floor and ceiling
 *   ">=0.9.12 <0.10"     0.x, where each minor may break
 *   "npm:pkg@^1.2.3"     aliased, bounded
 *
 * WHAT FAILS
 *   ">=3.15.2"           no ceiling — the bug above
 *   ">4"  "*"  "latest"  no ceiling
 *
 * Usage: node scripts/check-dependency-overrides.mjs
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const PKG = path.join(ROOT, 'package.json')

const pkg = JSON.parse(readFileSync(PKG, 'utf8'))
const overrides = pkg.pnpm?.overrides ?? {}
const entries = Object.entries(overrides)

/** A range is bounded when some comparator caps it from above. */
function isBounded(rawRange) {
  // `npm:name@range` aliases — judge the range half.
  const range = rawRange.startsWith('npm:')
    ? rawRange.slice(rawRange.lastIndexOf('@') + 1)
    : rawRange

  const trimmed = range.trim()
  if (trimmed === '' || trimmed === '*' || trimmed === 'latest' || trimmed === 'x') return false

  // An upper comparator anywhere is an explicit ceiling.
  if (/<\s*\d/.test(trimmed)) return true

  // Caret, tilde, exact, and hyphen ranges all carry an implicit ceiling.
  // A leading `>=` or `>` with nothing above it does not.
  if (/^[~^]\s*\d/.test(trimmed)) return true
  if (/^\d+(\.\d+)*$/.test(trimmed)) return true
  if (/^=\s*\d/.test(trimmed)) return true
  if (/\s+-\s+\d/.test(trimmed)) return true // "1.2.3 - 2.3.4"

  return false
}

const unbounded = entries.filter(([, range]) => !isBounded(String(range)))

if (unbounded.length > 0) {
  console.error('✗  pnpm.overrides entries with no upper bound:\n')
  for (const [name, range] of unbounded) {
    const suggestion = suggestBound(String(range))
    console.error(`   "${name}": "${range}"`)
    if (suggestion) console.error(`       try: "${suggestion}"`)
  }
  console.error(
    `\n   An override that patches an advisory should raise the floor, not lift\n` +
      `   the ceiling. ">=X" alone lets every consumer cross the next major —\n` +
      `   that is how read-yaml-file@1.1.0 lost js-yaml's safeLoad and broke the\n` +
      `   Release workflow. Add an upper bound.\n`,
  )
  process.exit(1)
}

/** Suggest "<nextMajor" (or "<nextMinor" for 0.x, where minors may break). */
function suggestBound(range) {
  const m = range.match(/>=?\s*(\d+)\.(\d+)(?:\.\d+)?/)
  if (!m) return null
  const [, major, minor] = m
  if (major === '0') return `${range.trim()} <0.${Number(minor) + 1}`
  return `${range.trim()} <${Number(major) + 1}`
}

console.log(
  `✓  pnpm.overrides: all ${entries.length} entr${entries.length === 1 ? 'y is' : 'ies are'} bounded.`,
)
