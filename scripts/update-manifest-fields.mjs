#!/usr/bin/env node
// Backfill missing attribution/funding fields across packages/*/package.json.
// Fields: author, bugs, repository.directory, homepage (/tree/main → master), funding.
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PACKAGES = join(ROOT, 'packages')
const FUNDING = { type: 'github', url: 'https://github.com/sponsors/kensaurus' }

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

  if (!pkg.funding) {
    pkg.funding = FUNDING
    changed = true
  }

  if (changed) {
    writeFileSync(manifest, JSON.stringify(pkg, null, 2) + '\n')
    console.log(`Patched: packages/${name}/package.json`)
    patched++
  }
}

console.log(`\nDone — ${patched} package manifests updated.`)
