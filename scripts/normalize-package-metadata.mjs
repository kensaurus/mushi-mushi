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
 *   - `homepage`    → the canonical product site (cross-link)
 *   - `repository`  → { type, url, directory: "packages/<dir>" }
 *   - `bugs.url`    → the canonical issues URL
 *   - `author`      → the maintainer, linked to an account that exists
 *   - `engines.node`→ one floor for the whole constellation
 *   - `keywords`    → no stance-contradicting terms; `mushi` on the entry points
 *   - `description` → mojibake repaired; never past npm's 255-char search cut;
 *                     no legacy (comparison-tables-only) tagline
 *
 * Descriptions stay role-specific — npm discovery relies on that text, and
 * deleting it to satisfy a "one tagline" reading would be a discovery
 * regression. The primary entry points (PRIMARY_ROLES) get a short role phrase
 * followed by ONE shared pitch composed from @mushi-mushi/brand
 * (MUSHI_TAGLINE_V2.category + MUSHI_TAGLINE_V2.promise), so the seven cards a
 * stranger actually lands on all say the positioning, and a brand change
 * propagates here on the next --write.
 *
 * Usage:
 *   node scripts/normalize-package-metadata.mjs           # check (default)
 *   node scripts/normalize-package-metadata.mjs --write   # apply fixes
 * Exit 0 = clean (check), or every drift fixed (--write).
 * Exit 1 = drift found that --write would fix, or an error only a human can
 *          fix (a description over the cap, a legacy tagline).
 */

import { closeSync, existsSync, ftruncateSync, openSync, readdirSync, readFileSync, realpathSync, statSync, writeSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { MUSHI_TAGLINE_LEGACY, MUSHI_TAGLINE_V2 } from '../packages/brand/src/index.js'

const __dir = fileURLToPath(new URL('.', import.meta.url))
const ROOT = join(__dir, '..')
const PKGS = join(ROOT, 'packages')

export const CANONICAL_HOMEPAGE = 'https://kensaur.us/mushi-mushi'
export const REPO_URL = 'https://github.com/kensaurus/mushi-mushi.git'
export const ISSUES_URL = 'https://github.com/kensaurus/mushi-mushi/issues'
// The GitHub account is the one identity that is guaranteed to exist (it owns
// the repo every manifest already links to). The previous Bluesky handle
// `mushimushi.dev` was never reserved, so the author link on npm resolved to
// nothing and could be claimed by whoever registers the domain.
export const CANONICAL_AUTHOR = 'Kenji Sakuramoto <kensaurus@gmail.com> (https://github.com/kensaurus)'
// `@mushi-mushi/core` needs 20.19 (require(esm) unflagged) and every SDK
// depends on it, so a lower floor elsewhere only produced mismatched
// EBADENGINE warnings. Node 20 itself is EOL (2026-04-30); raising the floor
// to 22 is a breaking change for yarn-classic installs and is left for a
// deliberate major.
export const NODE_ENGINE = '>=20.19.0'
// npm's search index keeps 255 characters; past that the card ends mid-word.
export const DESCRIPTION_HARD_MAX = 255
// Primary entry points must read in full on a search card.
export const PRIMARY_DESCRIPTION_MAX = 140
// Mushi is a Sentry companion (VISION.md) — this keyword says the opposite.
export const BANNED_KEYWORDS = ['sentry-alternative']

const lowerFirst = (s) => s.charAt(0).toLowerCase() + s.slice(1)

/** "The bug mediator for AI-built apps: plain-English diagnosis + a ready fix, in your editor." */
export const NPM_PITCH = `${MUSHI_TAGLINE_V2.category}: ${lowerFirst(MUSHI_TAGLINE_V2.promise)}.`

/**
 * Role phrase for each primary entry point. The npm description is
 * `${role} ${NPM_PITCH}` — keep the role concrete (what the package is, in the
 * words people search for) and short enough to stay under
 * PRIMARY_DESCRIPTION_MAX.
 */
export const PRIMARY_ROLES = {
  'mushi-mushi': 'One command adds a bug report widget to any app.',
  '@mushi-mushi/cli': 'Mushi CLI: SDK setup, MCP wiring, bug triage.',
  '@mushi-mushi/mcp': 'MCP server for Cursor, Claude Code and Copilot.',
  '@mushi-mushi/core': 'Types, API client and pre-filter for Mushi SDKs.',
  '@mushi-mushi/web': 'Bug report and user feedback widget for the web.',
  '@mushi-mushi/react': 'React and Next.js bug report widget and hooks.',
  '@mushi-mushi/react-native': 'Shake-to-report widget for React Native and Expo.',
}

/** Keywords an entry point must carry (npm ranks the bare brand query on them). */
export const REQUIRED_KEYWORDS = {
  'mushi-mushi': ['mushi'],
  '@mushi-mushi/mcp': ['mushi'],
}

/** Legacy v1 tagline strings — comparison-tables-only, never a package card. */
const LEGACY_LINES = [MUSHI_TAGLINE_LEGACY.full, MUSHI_TAGLINE_LEGACY.short]

export function primaryDescription(name) {
  const role = PRIMARY_ROLES[name]
  return role === undefined ? undefined : `${role} ${NPM_PITCH}`
}

// Common UTF-8-read-as-latin1 mojibake → correct glyph.
const MOJIBAKE = [
  ['â€”', '—'], // â€” → —
  ['â€“', '–'], // â€“ → –
  ['â€™', '’'], // â€™ → ’
  ['â€œ', '“'], // â€œ → “
  ['â€\u009d', '”'], // â€ → ”
  ['â€¦', '…'], // â€¦ → …
]

function fixMojibake(s) {
  if (typeof s !== 'string') return s
  let out = s
  for (const [bad, good] of MOJIBAKE) out = out.split(bad).join(good)
  return out
}

/**
 * Normalize one publishable manifest. Pure: returns a new object plus the list
 * of auto-fixed fields (`changes`) and problems --write cannot fix (`errors`).
 *
 * @param {Record<string, unknown>} manifest parsed package.json
 * @param {string} dir the folder name under packages/
 */
export function normalizeManifest(manifest, dir) {
  const json = structuredClone(manifest)
  const changes = []
  const errors = []

  const want = primaryDescription(json.name)
  if (want !== undefined) {
    if (json.description !== want) {
      json.description = want
      changes.push('description (brand pitch)')
    }
    if (want.length > PRIMARY_DESCRIPTION_MAX) {
      errors.push(
        `description is ${want.length} chars; primary entry points must stay ≤ ${PRIMARY_DESCRIPTION_MAX} — shorten PRIMARY_ROLES["${json.name}"]`,
      )
    }
  } else {
    const fixedDesc = fixMojibake(json.description)
    if (fixedDesc !== json.description) {
      json.description = fixedDesc
      changes.push('description (encoding)')
    }
  }

  if (typeof json.description !== 'string' || json.description.length === 0) {
    errors.push('description is missing')
  } else {
    if (json.description.length > DESCRIPTION_HARD_MAX) {
      errors.push(
        `description is ${json.description.length} chars; npm search cuts it at ${DESCRIPTION_HARD_MAX} — rewrite it shorter`,
      )
    }
    for (const legacy of LEGACY_LINES) {
      if (json.description.includes(legacy)) {
        errors.push(`description uses the legacy tagline "${legacy}" (comparison tables only)`)
      }
    }
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

  if (!json.engines || json.engines.node !== NODE_ENGINE) {
    json.engines = { ...(json.engines ?? {}), node: NODE_ENGINE }
    changes.push('engines.node')
  }

  if (Array.isArray(json.keywords)) {
    const kept = json.keywords.filter((k) => !BANNED_KEYWORDS.includes(k))
    if (kept.length !== json.keywords.length) {
      json.keywords = kept
      changes.push('keywords (banned)')
    }
  }
  const required = REQUIRED_KEYWORDS[json.name] ?? []
  const missing = required.filter((k) => !(json.keywords ?? []).includes(k))
  if (missing.length > 0) {
    json.keywords = [...(json.keywords ?? []), ...missing]
    changes.push('keywords (required)')
  }

  return { json, changes, errors }
}

function main() {
  const write = process.argv.includes('--write')
  let changedFiles = 0
  let errorCount = 0

  for (const dir of readdirSync(PKGS)) {
    const pkgDir = join(PKGS, dir)
    if (!statSync(pkgDir).isDirectory()) continue
    const pkgPath = join(pkgDir, 'package.json')
    if (!existsSync(pkgPath)) continue

    // Read and (with --write) rewrite through one descriptor, so the file that
    // was normalized is the file that gets written.
    const fd = openSync(pkgPath, write ? 'r+' : 'r')
    try {
      const manifest = JSON.parse(readFileSync(fd, 'utf8'))
      if (manifest.private) continue // skip non-published workspace packages
      if (!manifest.name) continue

      const { json, changes, errors } = normalizeManifest(manifest, dir)

      for (const e of errors) {
        errorCount++
        console.error(`ERROR  ${manifest.name.padEnd(36)} → ${e}`)
      }
      if (changes.length) {
        changedFiles++
        console.log(`${write ? 'FIX ' : 'DRIFT'}  ${manifest.name.padEnd(36)} → ${changes.join(', ')}`)
        if (write) {
          ftruncateSync(fd, 0)
          writeSync(fd, JSON.stringify(json, null, 2) + '\n', 0, 'utf8')
        }
      }
    } finally {
      closeSync(fd)
    }
  }

  if (changedFiles === 0 && errorCount === 0) {
    console.log('✓  package metadata: all publishable packages cross-linked + clean.')
    process.exit(0)
  }
  if (changedFiles > 0) {
    console.log(`\n${changedFiles} package(s) ${write ? 'updated' : 'need normalization (run with --write)'}.`)
  }
  if (errorCount > 0) {
    console.error(`\n${errorCount} problem(s) --write cannot fix — edit the package.json by hand.`)
    process.exit(1)
  }
  process.exit(write ? 0 : 1)
}

// Run only as the entry script (the tests import this module). Compare real
// paths: Node resolves the entry through symlinks and junctions but leaves
// process.argv[1] as typed, so a plain URL comparison skips main() and exits 0
// without checking anything when the repo is reached through a link.
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
