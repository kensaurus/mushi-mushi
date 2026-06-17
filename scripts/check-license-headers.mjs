#!/usr/bin/env node
/**
 * check-license-headers.mjs
 *
 * Enforces that every package's `package.json#license` field matches the
 * canonical license the workspace has chosen for its folder:
 *
 *   - `packages/server`, `packages/agents`, `packages/verify` →
 *     AGPLv3 (GNU Affero General Public License v3.0). These server-side
 *     packages are true OSI-approved open source; the Section 13 "network
 *     use" copyleft applies to modified hosted deployments.
 *
 *   - Everything else under `packages/*` → MIT. SDKs, adapters, plugins,
 *     and CLI tooling are MIT so integrators can vendor/fork freely.
 *
 * The script is deliberately blunt: it reads each `package.json`, looks
 * up the folder in a static map, and fails if the declared license doesn't
 * match. It also checks that a `LICENSE` file exists in the same folder
 * and its first non-blank line contains the expected license name — so a
 * "license": "MIT" with a stale BSL LICENSE file can't sneak through.
 *
 * Matches `scripts/check-publish-readiness.mjs` in shape — both gate the
 * release pipeline; both surface every violation in one pass so ops can
 * fix them in a single round-trip.
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'

const ROOT = process.cwd()

// Folders whose packages publish under AGPLv3. Keep this list in sync with
// `README.md` and per-package LICENSE files — the lint will tell us if
// someone drops a new package into these folders without the AGPLv3 header.
const AGPL_FOLDERS = new Set([
  'packages/server',
  'packages/agents',
  'packages/verify',
])

/** Expected LICENSE file header marker per license kind. */
const LICENSE_MARKERS = {
  MIT: /^MIT License$/m,
  AGPL: /^GNU AFFERO GENERAL PUBLIC LICENSE$/m,
}

const violations = []

function pkgFolder(pkgPath) {
  return relative(ROOT, dirname(pkgPath)).replace(/\\/g, '/')
}

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === '.turbo') continue
    const full = join(dir, entry)
    const s = statSync(full)
    if (s.isDirectory()) yield* walk(full)
    else if (entry === 'package.json') yield full
  }
}

for (const pkgPath of walk(join(ROOT, 'packages'))) {
  let pkg
  try { pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) } catch (err) {
    violations.push({ pkg: pkgFolder(pkgPath), rule: 'parse', detail: err.message })
    continue
  }

  const folder = pkgFolder(pkgPath)
  const expectedLicense = AGPL_FOLDERS.has(folder) ? 'AGPL' : 'MIT'
  const declared = (pkg.license ?? '').toString()

  // Special-case: AGPL packages may declare via `"license": "AGPL-3.0-only"`,
  // `"AGPL-3.0"`, `"AGPL-3.0-or-later"`, or `"SEE LICENSE IN LICENSE"`. Accept all.
  const declaresAgpl = /^(agpl-?3\.0(-only|-or-later)?|see\s+license\s+in\s+license)$/i.test(declared)
  const declaresMit = /^mit$/i.test(declared)

  if (expectedLicense === 'AGPL' && !declaresAgpl) {
    violations.push({
      pkg: folder,
      rule: 'license',
      detail: `Expected AGPLv3 (declare as "AGPL-3.0-only" or "SEE LICENSE IN LICENSE"), got "${declared}"`,
    })
  }
  if (expectedLicense === 'MIT' && !declaresMit && pkg.private !== true) {
    violations.push({
      pkg: folder,
      rule: 'license',
      detail: `Expected MIT, got "${declared}"`,
    })
  }

  // LICENSE file presence + header cross-check.
  const licensePath = join(dirname(pkgPath), 'LICENSE')
  if (!existsSync(licensePath)) {
    if (pkg.private !== true) {
      violations.push({ pkg: folder, rule: 'license-file', detail: 'LICENSE file missing' })
    }
    continue
  }
  const licenseText = readFileSync(licensePath, 'utf8')
  const marker = LICENSE_MARKERS[expectedLicense]
  if (!marker.test(licenseText)) {
    violations.push({
      pkg: folder,
      rule: 'license-file-header',
      detail: `LICENSE file does not look like ${expectedLicense} (first marker not found)`,
    })
  }
}

if (violations.length > 0) {
  console.error(`\nLicense-header check found ${violations.length} violation(s):\n`)
  for (const v of violations) {
    console.error(`  [${v.rule}] ${v.pkg}`)
    console.error(`    → ${v.detail}`)
  }
  console.error('\nFix the above before publishing. See README.md for the workspace license policy.\n')
  process.exit(1)
}

console.log('OK: license-headers — every package matches its folder\'s license policy.')
