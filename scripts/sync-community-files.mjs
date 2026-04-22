#!/usr/bin/env node
// FILE: sync-community-files.mjs
// PURPOSE: Copy the canonical community files (CONTRIBUTING / CODE_OF_CONDUCT
//          / SECURITY) from the repo root into every publishable package
//          directory so they ship inside each npm tarball.
//
// Why: package registries (npm, Snyk, Socket) score a package as having a
// "community" (or "documentation" / "healthy-repo") signal only when these
// files are present inside the published tarball. Our monorepo keeps them at
// the root by convention — which means 0 publishable packages carry them by
// default, and Snyk/Socket report "Contributing.md: No, Code of Conduct: No"
// even though the repo itself has them. This script closes that gap without
// forcing humans to maintain N duplicates.
//
// Modes:
//   node scripts/sync-community-files.mjs            → write synced copies
//   node scripts/sync-community-files.mjs --check    → fail if any package
//                                                      has stale or missing
//                                                      synced copies (CI /
//                                                      pre-commit guard)
//
// Idempotent. Safe to run repeatedly. Skips private packages
// (`"private": true`). Every synced file is prefixed with an AUTO-SYNCED
// banner so humans edit only the root copy.

import { readFile, writeFile, readdir, stat } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const FILES = ['CONTRIBUTING.md', 'CODE_OF_CONDUCT.md', 'SECURITY.md']
const SEARCH_DIRS = ['packages']

const BANNER_PREFIX = '<!--\n  AUTO-SYNCED from repo root by scripts/sync-community-files.mjs.\n  Do not edit here — edit the canonical file at the repository root and\n  re-run `node scripts/sync-community-files.mjs` (pre-commit hook does this\n  automatically).\n-->\n\n'

async function readCanonical() {
  const out = {}
  for (const name of FILES) {
    const raw = await readFile(join(ROOT, name), 'utf8')
    out[name] = BANNER_PREFIX + raw
  }
  return out
}

async function findPackageDirs() {
  const dirs = []
  for (const parent of SEARCH_DIRS) {
    const base = join(ROOT, parent)
    let entries
    try {
      entries = await readdir(base)
    } catch {
      continue
    }
    for (const entry of entries) {
      const pkgJsonPath = join(base, entry, 'package.json')
      try {
        const st = await stat(pkgJsonPath)
        if (!st.isFile()) continue
        const pkg = JSON.parse(await readFile(pkgJsonPath, 'utf8'))
        if (pkg.private === true) continue
        dirs.push(join(base, entry))
      } catch {
        // no package.json — skip
      }
    }
  }
  return dirs
}

async function sync({ check }) {
  const canonical = await readCanonical()
  const dirs = await findPackageDirs()
  const drift = []
  let written = 0

  for (const dir of dirs) {
    for (const name of FILES) {
      const dest = join(dir, name)
      const want = canonical[name]
      let current = null
      try {
        current = await readFile(dest, 'utf8')
      } catch {
        // missing — treat as drift
      }
      if (current === want) continue
      if (check) {
        drift.push(relative(ROOT, dest).replaceAll('\\', '/'))
        continue
      }
      await writeFile(dest, want, 'utf8')
      written += 1
    }
  }

  if (check) {
    if (drift.length > 0) {
      console.error('\nsync-community-files --check FAILED — these files are missing or stale:\n')
      for (const f of drift) console.error(`  ${f}`)
      console.error('\nRun `node scripts/sync-community-files.mjs` to regenerate, then commit.\n')
      process.exit(1)
    }
    console.log(`sync-community-files --check OK — scanned ${dirs.length} publishable package(s).`)
    return
  }

  console.log(`sync-community-files wrote ${written} file(s) across ${dirs.length} publishable package(s).`)
}

const check = process.argv.includes('--check')
sync({ check }).catch((err) => {
  console.error('sync-community-files crashed:', err)
  process.exit(2)
})
