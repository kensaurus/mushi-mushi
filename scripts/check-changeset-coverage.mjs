#!/usr/bin/env node
/**
 * check-changeset-coverage.mjs
 *
 * The reverse of check-changeset-orphans.mjs: every publishable package whose
 * shipped source changed on this branch must be named in a pending changeset.
 * Otherwise the change merges to master and never reaches npm, while the docs
 * that describe it deploy on the same merge.
 *
 * `changeset status --since=<base>` does not catch this. It fails only when a
 * branch changed packages and has NO changesets at all, so a single changeset
 * for core lets an uncovered mcp or cli change through (observed on
 * feat/gtm-phase1-measure: three new MCP tools and a `mushi status` change
 * with only a core/web/react/react-native/node changeset planned).
 *
 * "Shipped source" = files under packages/<dir>/src/ that are not tests,
 * snapshots or mocks. README, manifest and test-only edits do not require a
 * release. Packages that are private or listed in .changeset/config.json#ignore
 * are never publishable, so they are skipped.
 *
 * Base: the merge-base of HEAD and `origin/master` (override: --base <ref>).
 * The diff runs against the working tree, so uncommitted edits count locally.
 * A base that cannot be resolved is an error, never a silent pass — in CI,
 * check out with `fetch-depth: 0` so origin/master exists.
 *
 * Usage:
 *   node scripts/check-changeset-coverage.mjs [--base <ref>]
 * Exit 0 = every changed publishable package is covered.
 * Exit 1 = uncovered packages (listed with the files that changed).
 * Exit 2 = the base ref or merge-base could not be resolved.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const CHANGESET_DIR = join(ROOT, '.changeset')

/**
 * Parse a changeset's YAML frontmatter into the set of package names it
 * targets. Same fixed shape check-changeset-orphans.mjs parses:
 *   ---
 *   "@mushi-mushi/web": patch
 *   ---
 */
export function parseChangesetTargets(content) {
  const match = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/m)
  const targets = new Set()
  if (!match) return targets
  for (const line of match[1].split(/\r?\n/)) {
    const m = line.trim().match(/^['"]?([^'":\s]+)['"]?\s*:\s*['"]?(major|minor|patch)['"]?\s*$/)
    if (m) targets.add(m[1])
  }
  return targets
}

/** True for a path (relative to the package folder) that ships to npm as source. */
export function isShippedSource(pathInPackage) {
  if (!pathInPackage.startsWith('src/')) return false
  if (/(^|\/)(__tests__|__snapshots__|__mocks__)\//.test(pathInPackage)) return false
  if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(pathInPackage)) return false
  return true
}

/**
 * @param {object} input
 * @param {string[]} input.changedFiles repo-relative, forward-slash paths
 * @param {{ dir: string, name: string, private?: boolean }[]} input.packages
 * @param {Set<string>} input.ignored package names in .changeset/config.json#ignore
 * @param {Set<string>} input.covered package names targeted by pending changesets
 * @returns {{ name: string, dir: string, files: string[] }[]}
 */
export function findUncovered({ changedFiles, packages, ignored, covered }) {
  const byDir = new Map(packages.map((p) => [p.dir, p]))
  const hits = new Map()
  for (const file of changedFiles) {
    const m = file.match(/^packages\/([^/]+)\/(.+)$/)
    if (!m) continue
    const pkg = byDir.get(m[1])
    if (!pkg || pkg.private || ignored.has(pkg.name) || covered.has(pkg.name)) continue
    if (!isShippedSource(m[2])) continue
    const entry = hits.get(pkg.name) ?? { name: pkg.name, dir: pkg.dir, files: [] }
    entry.files.push(file)
    hits.set(pkg.name, entry)
  }
  return [...hits.values()].sort((a, b) => a.name.localeCompare(b.name))
}

function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

function readPackages() {
  const out = []
  const pkgsDir = join(ROOT, 'packages')
  for (const dir of readdirSync(pkgsDir)) {
    const pkgPath = join(pkgsDir, dir, 'package.json')
    if (!existsSync(pkgPath)) continue
    const json = JSON.parse(readFileSync(pkgPath, 'utf8'))
    if (typeof json.name !== 'string') continue
    out.push({ dir, name: json.name, private: json.private === true })
  }
  return out
}

function readCovered() {
  const covered = new Set()
  for (const f of readdirSync(CHANGESET_DIR)) {
    if (!f.endsWith('.md') || f === 'README.md') continue
    for (const name of parseChangesetTargets(readFileSync(join(CHANGESET_DIR, f), 'utf8'))) {
      covered.add(name)
    }
  }
  return covered
}

function main() {
  const baseIdx = process.argv.indexOf('--base')
  const baseRef = baseIdx === -1 ? 'origin/master' : process.argv[baseIdx + 1]
  if (!baseRef) {
    console.error('check-changeset-coverage: --base needs a ref')
    process.exit(2)
  }

  let mergeBase
  try {
    git(['rev-parse', '--verify', '--quiet', `${baseRef}^{commit}`])
    mergeBase = git(['merge-base', 'HEAD', baseRef]).trim()
  } catch {
    console.error(`check-changeset-coverage: cannot resolve a merge-base with "${baseRef}".`)
    console.error('  In CI, check out with `fetch-depth: 0`; locally, `git fetch origin master`.')
    process.exit(2)
  }

  const changedFiles = git(['diff', '--name-only', '-z', mergeBase])
    .split('\0')
    .filter(Boolean)
    .map((f) => f.replace(/\\/g, '/'))
  const config = JSON.parse(readFileSync(join(CHANGESET_DIR, 'config.json'), 'utf8'))
  const uncovered = findUncovered({
    changedFiles,
    packages: readPackages(),
    ignored: new Set(config.ignore ?? []),
    covered: readCovered(),
  })

  if (uncovered.length === 0) {
    console.log(
      `check-changeset-coverage: every publishable package with shipped source changes since ${baseRef} has a pending changeset.`,
    )
    return
  }

  console.error(`check-changeset-coverage: shipped source changed since ${baseRef} with no pending changeset:\n`)
  for (const u of uncovered) {
    console.error(`  • ${u.name}  (packages/${u.dir})`)
    for (const f of u.files.slice(0, 5)) console.error(`      ${f}`)
    if (u.files.length > 5) console.error(`      … and ${u.files.length - 5} more`)
  }
  console.error('')
  console.error('Without a changeset these changes merge but never publish to npm.')
  console.error('Fix: run `pnpm changeset` and select each package above (or add it to an')
  console.error('existing .changeset/*.md frontmatter, e.g. `"@mushi-mushi/cli": minor`).')
  process.exit(1)
}

// Run only as the entry script (the tests import this module). Compare real
// paths: Node resolves the entry through symlinks and junctions but leaves
// process.argv[1] as typed, so a plain URL comparison skips main() and the
// gate exits 0 without checking anything when the repo is reached through a link.
function isEntryScript() {
  if (!process.argv[1]) return false
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    // An unreadable path: fall back to the plain comparison rather than
    // skip the check.
    return import.meta.url === pathToFileURL(process.argv[1]).href
  }
}

if (isEntryScript()) main()
