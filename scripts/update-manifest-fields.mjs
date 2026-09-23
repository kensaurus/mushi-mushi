#!/usr/bin/env node
// Backfill missing attribution fields across packages/*/package.json.
// Fields: author, bugs, repository.directory, homepage (/tree/main → master).
//
// No `funding` field: GitHub Sponsors is not enabled for kensaurus
// (github.com/sponsors/kensaurus redirects to the profile), so the field only
// gave `npm fund` and the npm sidebar a dead link. When Sponsors is live,
// restore it here as { type: 'github', url: 'https://github.com/sponsors/kensaurus' }
// and backfill it with `if (!pkg.funding)`.
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PACKAGES = join(ROOT, 'packages')

let patched = 0

for (const name of readdirSync(PACKAGES)) {
  const manifest = join(PACKAGES, name, 'package.json')
  if (!existsSync(manifest)) continue

  let pkg
  try {
    pkg = JSON.parse(readFileSync(manifest, 'utf8'))
  } catch {
    continue
  }

  let changed = false

  if (!pkg.author) {
    pkg.author = 'Kenji Sakuramoto'
    changed = true
  }

  if (!pkg.bugs || pkg.bugs.url !== 'https://github.com/kensaurus/mushi-mushi/issues') {
    pkg.bugs = { url: 'https://github.com/kensaurus/mushi-mushi/issues' }
    changed = true
  }

  if (!pkg.repository || !pkg.repository.directory) {
    pkg.repository = {
      type: 'git',
      url: 'https://github.com/kensaurus/mushi-mushi.git',
      directory: `packages/${name}`,
    }
    changed = true
  }

  // Fix stale /tree/main/ homepage references
  if (pkg.homepage && pkg.homepage.includes('/tree/main/')) {
    pkg.homepage = pkg.homepage.replace('/tree/main/', '/tree/master/')
    changed = true
  }

  if (changed) {
    writeFileSync(manifest, JSON.stringify(pkg, null, 2) + '\n')
    console.log(`Patched: packages/${name}/package.json`)
    patched++
  }
}

console.log(`\nDone — ${patched} package manifests updated.`)
