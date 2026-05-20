#!/usr/bin/env node
/**
 * check-changeset-orphans.mjs
 *
 * Pre-release gate: every `.changeset/*.md` file must affect at least one
 * publishable package. A changeset that only targets packages listed in
 * `.changeset/config.json#ignore` is an **orphan** — it produces no
 * version bumps, no entries in any per-package CHANGELOG, and causes the
 * Release workflow to fail with `No commits between master and
 * changeset-release/master` after `changeset version` runs (observed
 * 2026-05-19, PR #102 / #121).
 *
 * This script reads every pending changeset, parses the YAML frontmatter
 * (which Changesets uses as a `{pkg: bumpLevel}` map), and fails if any
 * changeset has zero non-ignored packages. The error message tells the
 * author which file is orphaned and how to fix it.
 *
 * Exits 0 when every pending changeset has at least one publishable
 * target, 1 otherwise.
 *
 * Hook this into both PR CI and the Release workflow's `ci` job so a
 * release can never queue against a master tip that would explode the
 * version PR.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const REPO_ROOT = join(__dirname, '..')
const CHANGESET_DIR = join(REPO_ROOT, '.changeset')
const CONFIG_PATH = join(CHANGESET_DIR, 'config.json')

function readJsonSync(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

/**
 * Parse a changeset markdown file's YAML frontmatter into a {pkg: bump}
 * map. We deliberately avoid pulling in a YAML dependency — the
 * frontmatter shape is fixed by the Changesets CLI:
 *   ---
 *   "@mushi-mushi/web": patch
 *   "@mushi-mushi/core": minor
 *   ---
 *   <body>
 */
function parseChangeset(content) {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/m)
  if (!match) return {}
  const targets = {}
  for (const line of match[1].split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    // Match: "@scope/name": bumpLevel  OR  unquoted-name: bumpLevel
    const m = trimmed.match(/^['"]?([^'":\s]+)['"]?\s*:\s*['"]?([a-z]+)['"]?\s*$/)
    if (m) targets[m[1]] = m[2]
  }
  return targets
}

function main() {
  if (!existsSync(CONFIG_PATH)) {
    console.error(`check-changeset-orphans: ${CONFIG_PATH} not found`)
    process.exit(1)
  }
  const config = readJsonSync(CONFIG_PATH)
  const ignored = new Set(config.ignore ?? [])

  const files = readdirSync(CHANGESET_DIR)
    .filter((f) => f.endsWith('.md') && f !== 'README.md')
    .map((f) => join(CHANGESET_DIR, f))

  if (files.length === 0) {
    console.log('check-changeset-orphans: no pending changesets — ok.')
    return
  }

  const violations = []
  for (const file of files) {
    const targets = parseChangeset(readFileSync(file, 'utf8'))
    const pkgs = Object.keys(targets)
    if (pkgs.length === 0) {
      violations.push({
        file,
        reason: 'No package targets parsed from frontmatter.',
      })
      continue
    }
    const publishable = pkgs.filter((p) => !ignored.has(p))
    if (publishable.length === 0) {
      violations.push({
        file,
        reason: `All targets are in .changeset/config.json#ignore: ${pkgs.join(', ')}`,
      })
    }
  }

  if (violations.length === 0) {
    console.log(
      `check-changeset-orphans: ${files.length} pending changeset(s) — all have publishable targets.`,
    )
    return
  }

  console.error('check-changeset-orphans: found orphaned changeset(s):')
  for (const v of violations) {
    const rel = v.file.replace(REPO_ROOT + '\\', '').replace(REPO_ROOT + '/', '')
    console.error(`  • ${rel}`)
    console.error(`    ${v.reason}`)
  }
  console.error('')
  console.error('Why this fails the release:')
  console.error('  A changeset that only targets ignored packages produces zero')
  console.error('  version bumps. The Release workflow then opens an empty version')
  console.error('  PR which causes "No commits between master and')
  console.error('  changeset-release/master" on the next push.')
  console.error('')
  console.error('Fix:')
  console.error('  • If the change really only affects an ignored (server/admin/docs)')
  console.error('    package, delete the changeset file — its diff lives in git history.')
  console.error('  • If a publishable package is also affected, add it to the')
  console.error('    frontmatter (e.g. `"@mushi-mushi/cli": patch`).')
  process.exit(1)
}

main()
