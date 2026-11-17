#!/usr/bin/env node
// FILE: sync-community-files.mjs
// PURPOSE: Copy the canonical community files (CONTRIBUTING / CODE_OF_CONDUCT
//          / SECURITY) from .github/ into every publishable package
//          directory, so someone browsing packages/<name>/ on GitHub finds
//          them next to the package's README.
//
// They are NOT shipped to npm. They used to be listed in every package's
// `files` so Snyk/Socket would score a "community" signal, which put 32 KB of
// repository governance docs into every tarball — more than the whole of some
// packages. npm links each package to this repository, where the root copies
// live (in .github/). `--check` fails if a publishable package lists one of them in
// `files` again.
//
// Modes:
//   node scripts/sync-community-files.mjs            → write synced copies
//   node scripts/sync-community-files.mjs --check    → fail if any package
//                                                      has stale or missing
//                                                      synced copies, or
//                                                      ships one in `files`
//                                                      (CI / pre-commit guard)
//
// Idempotent. Safe to run repeatedly. Skips private packages
// (`"private": true`). Every synced file is prefixed with an AUTO-SYNCED
// banner so humans edit only the .github/ copy.

import { readFile, writeFile, readdir } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const FILES = ['CONTRIBUTING.md', 'CODE_OF_CONDUCT.md', 'SECURITY.md']
const SEARCH_DIRS = ['packages']

// The canonical copies live in .github/ (GitHub's community profile reads them there).
const CANONICAL_DIR = join(ROOT, '.github')
const BANNER_PREFIX = '<!--\n  AUTO-SYNCED from .github/ by scripts/sync-community-files.mjs.\n  Do not edit here — edit the canonical file in .github/ and\n  re-run `node scripts/sync-community-files.mjs` (pre-commit hook does this\n  automatically).\n-->\n\n'

async function readCanonical() {
  const out = {}
  for (const name of FILES) {
    const raw = await readFile(join(CANONICAL_DIR, name), 'utf8')
    out[name] = BANNER_PREFIX + raw
  }
  return out
}

// The canonical files link relative to .github/ (`../docs/DEPLOYMENT.md`,
// `../docs/legal/COMMERCIAL-LICENSE.md`); from packages/<name>/ those resolve
// inside the package and 404, so resolve each from .github/ and re-point it
// from the package directory.
function rebaseRelativeLinks(text, pkgDir) {
  return text.replace(/\]\((?!https?:|mailto:|#|\/)([^)\s]+)\)/g, (_m, target) => {
    const hashAt = target.indexOf('#')
    const path = hashAt === -1 ? target : target.slice(0, hashAt)
    const hash = hashAt === -1 ? '' : target.slice(hashAt)
    const rel = path ? relative(pkgDir, resolve(CANONICAL_DIR, path)).replaceAll('\\', '/') : ''
    return `](${rel}${hash})`
  })
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
      // Read directly — separate stat() + readFile() would be a TOCTOU race
      // (js/file-system-race). ENOENT / EISDIR bubble up as a caught error.
      try {
        const raw = await readFile(pkgJsonPath, 'utf8')
        const pkg = JSON.parse(raw)
        if (pkg.private === true) continue
        dirs.push({ dir: join(base, entry), files: Array.isArray(pkg.files) ? pkg.files : [] })
      } catch {
        // no package.json, unreadable, or malformed — skip
      }
    }
  }
  return dirs
}

async function sync({ check }) {
  const canonical = await readCanonical()
  const packages = await findPackageDirs()
  const drift = []
  const shipped = []
  let written = 0

  for (const { dir, files } of packages) {
    for (const name of files.filter((f) => FILES.includes(f))) {
      shipped.push(`${relative(ROOT, join(dir, 'package.json')).replaceAll('\\', '/')} → files: "${name}"`)
    }
    for (const name of FILES) {
      const dest = join(dir, name)
      const want = rebaseRelativeLinks(canonical[name], dir)
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

  if (shipped.length > 0) {
    console.error('\nsync-community-files FAILED — these packages ship repository governance docs to npm:\n')
    for (const s of shipped) console.error(`  ${s}`)
    console.error('\nRemove them from `files`. The copies stay in the package folder for GitHub; npm links to the repo.\n')
    process.exit(1)
  }

  if (check) {
    if (drift.length > 0) {
      console.error('\nsync-community-files --check FAILED — these files are missing or stale:\n')
      for (const f of drift) console.error(`  ${f}`)
      console.error('\nRun `node scripts/sync-community-files.mjs` to regenerate, then commit.\n')
      process.exit(1)
    }
    console.log(`sync-community-files --check OK — scanned ${packages.length} publishable package(s).`)
    return
  }

  console.log(`sync-community-files wrote ${written} file(s) across ${packages.length} publishable package(s).`)
}

const check = process.argv.includes('--check')
sync({ check }).catch((err) => {
  console.error('sync-community-files crashed:', err)
  process.exit(2)
})
