#!/usr/bin/env node
// FILE: check-packed-tarballs.mjs
// PURPOSE: Pre-publish gate — `pnpm pack` every publishable package and assert
// the tarball's package.json has no workspace/link/file protocol specifiers in
// dependencies or peerDependencies. Catches leaks that bare `npm publish` would
// ship (see @mushi-mushi/mcp@0.10.0 incident).
//
// Run via:  node scripts/check-packed-tarballs.mjs
// Exits 0 when every packed manifest is clean, 1 on any leak.

import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const SEARCH_DIRS = ['packages']
const PROTOCOL_RE = /^(workspace|link|file|portal|catalog):/

function sourceHasWorkspaceProtocol(pkg) {
  for (const field of ['dependencies', 'peerDependencies']) {
    const deps = pkg[field]
    if (!deps) continue
    for (const spec of Object.values(deps)) {
      if (typeof spec === 'string' && PROTOCOL_RE.test(spec)) return true
    }
  }
  return false
}

function collectLeaks(pkg) {
  const leaks = []
  for (const field of ['dependencies', 'peerDependencies']) {
    const deps = pkg[field]
    if (!deps) continue
    for (const [name, spec] of Object.entries(deps)) {
      if (typeof spec === 'string' && PROTOCOL_RE.test(spec)) {
        leaks.push({ field, name, spec })
      }
    }
  }
  return leaks
}

async function packAndInspect(pkgDir) {
  const workDir = await mkdtemp(join(tmpdir(), 'mushi-pack-check-'))
  try {
    const out = execFileSync('pnpm', ['pack', '--pack-destination', workDir], {
      cwd: pkgDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
      // Windows: pnpm is a .cmd shim; shell:true resolves it in CI and local dev.
      shell: true,
    })
    const tarballLine = out.trim().split('\n').find((l) => l.endsWith('.tgz'))
    if (!tarballLine) throw new Error('pnpm pack did not print a tarball path')
    const tarPath = tarballLine.trim()
    const extractDir = join(workDir, 'extract')
    await mkdir(extractDir, { recursive: true })
    execFileSync('tar', ['--force-local', '-xzf', tarPath, '-C', extractDir], {
      stdio: 'inherit',
      shell: true,
    })
    const manifest = JSON.parse(await readFile(join(extractDir, 'package', 'package.json'), 'utf8'))
    return collectLeaks(manifest)
  } finally {
    await rm(workDir, { recursive: true, force: true })
  }
}

async function main() {
  const failures = []
  let checked = 0

  for (const dir of SEARCH_DIRS) {
    const base = join(ROOT, dir)
    for (const entry of await readdir(base)) {
      const pkgPath = join(base, entry, 'package.json')
      let pkg
      try {
        pkg = JSON.parse(await readFile(pkgPath, 'utf8'))
      } catch {
        continue
      }
      if (pkg.private === true) continue
      if (!sourceHasWorkspaceProtocol(pkg)) continue
      checked += 1
      const rel = relative(ROOT, join(base, entry)).replaceAll('\\', '/')
      try {
        const leaks = await packAndInspect(join(base, entry))
        if (leaks.length === 0) {
          console.log(`OK   ${rel}`)
        } else {
          failures.push({ rel, leaks })
          console.error(`FAIL ${rel}`)
          for (const l of leaks) console.error(`     ${l.field}["${l.name}"] = "${l.spec}"`)
        }
      } catch (err) {
        failures.push({ rel, error: err.message })
        console.error(`FAIL ${rel} — ${err.message}`)
      }
    }
  }

  if (failures.length > 0) {
    console.error(`\n${failures.length} package(s) would ship broken tarballs. Use pnpm publish, not npm publish.`)
    process.exit(1)
  }
  if (checked === 0) {
    console.log('packed-tarball guard OK — no packages with workspace-protocol deps to verify.')
    return
  }
  console.log(`\npacked-tarball guard OK — ${checked} package(s) with workspace deps verified.`)
}

main().catch((err) => {
  console.error('check-packed-tarballs crashed:', err)
  process.exit(2)
})
