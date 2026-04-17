#!/usr/bin/env node
// FILE: check-workspace-protocol.mjs
// PURPOSE: Fail the build if any publishable package leaks `workspace:*`
// (or any other workspace-protocol specifier) into `dependencies` or
// `peerDependencies`. Such specifiers MUST be replaced with real semver ranges
// at publish time; otherwise external `npm install` fails with EUNSUPPORTEDPROTOCOL.
//
// Background: in 2026-04 all @mushi-mushi/*@0.1.0 packages were published with
// `"@mushi-mushi/core": "workspace:*"` baked into the tarballs because
// `changeset publish` was invoked without `changeset version` having rewritten
// the workspace specifiers first. This guard prevents that recurrence.
//
// Devs may still see `workspace:*` in source package.json — that is correct and
// required by pnpm. The check runs at publish time (after `changeset version`
// has executed), at which point all internal deps must be real semver ranges.
//
// Run via:  node scripts/check-workspace-protocol.mjs
// Exits 0 when clean, 1 when any leak is detected.

import { readFile, readdir, stat } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SEARCH_DIRS = ['packages', 'apps']
// Block ONLY the unsafe specifiers. `workspace:^` and `workspace:~` are the
// recommended pnpm syntax — pnpm replaces them with a real `^X.Y.Z` / `~X.Y.Z`
// range in the published tarball at `pnpm publish` time. `workspace:*` and the
// other protocols (link/file/portal/catalog) DO leak into tarballs and break
// `npm install` for end users (see CVE-style incident in 2026-04, `ed64f7f`).
const PROTOCOL_RE = /^(workspace:\*|link:|file:|portal:|catalog:)/

async function findPackageManifests(rootDir) {
  const manifests = []
  for (const dir of SEARCH_DIRS) {
    const base = join(rootDir, dir)
    let entries
    try {
      entries = await readdir(base)
    } catch {
      continue
    }
    for (const entry of entries) {
      const manifestPath = join(base, entry, 'package.json')
      try {
        const stats = await stat(manifestPath)
        if (stats.isFile()) manifests.push(manifestPath)
      } catch {
        // No package.json in this folder — skip.
      }
    }
  }
  return manifests
}

function collectLeaks(pkgJson, manifestPath) {
  const leaks = []
  for (const field of ['dependencies', 'peerDependencies']) {
    const deps = pkgJson[field]
    if (!deps) continue
    for (const [name, spec] of Object.entries(deps)) {
      if (typeof spec === 'string' && PROTOCOL_RE.test(spec)) {
        leaks.push({ manifest: manifestPath, field, name, spec })
      }
    }
  }
  return leaks
}

async function main() {
  const manifests = await findPackageManifests(ROOT)
  const allLeaks = []
  let publishable = 0

  for (const manifestPath of manifests) {
    const raw = await readFile(manifestPath, 'utf8')
    const pkg = JSON.parse(raw)
    if (pkg.private === true) continue
    publishable += 1
    allLeaks.push(...collectLeaks(pkg, manifestPath))
  }

  if (allLeaks.length === 0) {
    console.log(`workspace-protocol guard OK — scanned ${publishable} publishable package(s).`)
    return
  }

  console.error('\nworkspace-protocol guard FAILED — these specifiers would break npm install for end users:\n')
  for (const leak of allLeaks) {
    const rel = relative(ROOT, leak.manifest).replaceAll('\\', '/')
    console.error(`  ${rel}  →  ${leak.field}["${leak.name}"] = "${leak.spec}"`)
  }
  console.error(
    [
      '',
      'Run `pnpm changeset version` (or merge the "Version Packages" PR) before publishing.',
      'That step replaces workspace:* with real semver ranges in every package.json.',
      '',
    ].join('\n'),
  )
  process.exit(1)
}

main().catch((err) => {
  console.error('workspace-protocol guard crashed:', err)
  process.exit(2)
})
