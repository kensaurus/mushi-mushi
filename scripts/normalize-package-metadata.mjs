#!/usr/bin/env node
/**
 * normalize-package-metadata.mjs
 *
 * Namespace hygiene + cross-link consistency for every publishable package, so
 * a developer browsing npm sees ONE product (not 36 loosely-related packages)
 * and the *real* Mushi is unambiguous vs. the unrelated `Mushi-mushi` GitHub
 * user in the security/malware space (VISION.md / liftup plan §3.2).
 *
 * For each non-private packages/<dir>/package.json it guarantees:
 *   - `homepage`   → the canonical product site (cross-link)
 *   - `repository` → { type, url, directory: "packages/<dir>" }
 *   - `bugs.url`   → the canonical issues URL
 *   - `description`→ mojibake / mis-encoded dashes & quotes repaired
 *
 * It does NOT overwrite the role-specific description text — npm discovery
 * relies on it, and the product identity is already carried by "Mushi Mushi"
 * in each line + the unified homepage. (Deleting that signal to satisfy a
 * "one tagline" reading would be a discovery regression.)
 *
 * Usage:
 *   node scripts/normalize-package-metadata.mjs           # dry-run (default)
 *   node scripts/normalize-package-metadata.mjs --write   # apply changes
 * Exit 0 = no changes needed (in --check), or changes applied (in --write).
 * Exit 1 = (in --check) drift found that --write would fix.
 */

import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'fs'
import { join, basename } from 'path'
import { fileURLToPath } from 'url'

const __dir = fileURLToPath(new URL('.', import.meta.url))
const ROOT = join(__dir, '..')
const PKGS = join(ROOT, 'packages')

const CANONICAL_HOMEPAGE = 'https://kensaur.us/mushi-mushi'
const REPO_URL = 'https://github.com/kensaurus/mushi-mushi.git'
const ISSUES_URL = 'https://github.com/kensaurus/mushi-mushi/issues'
const CANONICAL_AUTHOR = 'Kenji Sakuramoto (https://bsky.app/profile/mushimushi.dev)'

// Common UTF-8-read-as-latin1 mojibake → correct glyph.
const MOJIBAKE = [
  ['\u00e2\u20ac\u201d', '\u2014'], // â€” → —
  ['\u00e2\u20ac\u201c', '\u2013'], // â€“ → –
  ['\u00e2\u20ac\u2122', '\u2019'], // â€™ → ’
  ['\u00e2\u20ac\u0153', '\u201c'], // â€œ → “
  ['\u00e2\u20ac\u009d', '\u201d'], // â€ → ”
  ['\u00e2\u20ac\u00a6', '\u2026'], // â€¦ → …
]

function fixMojibake(s) {
  if (typeof s !== 'string') return s
  let out = s
  for (const [bad, good] of MOJIBAKE) out = out.split(bad).join(good)
  return out
}

const write = process.argv.includes('--write')
let changedFiles = 0

for (const dir of readdirSync(PKGS)) {
  const pkgDir = join(PKGS, dir)
  if (!statSync(pkgDir).isDirectory()) continue
  const pkgPath = join(pkgDir, 'package.json')
  if (!existsSync(pkgPath)) continue

  const raw = readFileSync(pkgPath, 'utf8')
  const json = JSON.parse(raw)
  if (json.private) continue // skip non-published workspace packages
  if (!json.name) continue

  const changes = []

  const fixedDesc = fixMojibake(json.description)
  if (fixedDesc !== json.description) {
    json.description = fixedDesc
    changes.push('description (encoding)')
  }

  if (json.homepage !== CANONICAL_HOMEPAGE) {
    json.homepage = CANONICAL_HOMEPAGE
    changes.push('homepage')
  }

  const wantRepo = { type: 'git', url: REPO_URL, directory: `packages/${dir}` }
  if (JSON.stringify(json.repository) !== JSON.stringify(wantRepo)) {
    json.repository = wantRepo
    changes.push('repository.directory')
  }

  if (!json.bugs || json.bugs.url !== ISSUES_URL) {
    json.bugs = { url: ISSUES_URL }
    changes.push('bugs')
  }

  if (json.author !== CANONICAL_AUTHOR) {
    json.author = CANONICAL_AUTHOR
    changes.push('author')
  }

  if (changes.length) {
    changedFiles++
    console.log(`${write ? 'FIX ' : 'DRIFT'}  ${json.name.padEnd(36)} → ${changes.join(', ')}`)
    if (write) writeFileSync(pkgPath, JSON.stringify(json, null, 2) + '\n')
  }
}

if (changedFiles === 0) {
  console.log('\u2713  package metadata: all publishable packages cross-linked + clean.')
  process.exit(0)
}
console.log(`\n${changedFiles} package(s) ${write ? 'updated' : 'need normalization (run with --write)'}.`)
process.exit(write ? 0 : 1)
