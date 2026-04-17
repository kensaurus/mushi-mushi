#!/usr/bin/env node
// FILE: verify-published-tarballs.mjs
// PURPOSE: After `changeset publish` reports success, download each newly
// published tarball from the npm registry and assert that no workspace-protocol
// specifier leaked into `dependencies` or `peerDependencies`.
//
// This is the post-publish belt to the pre-publish suspenders in
// `check-workspace-protocol.mjs`. If both passed, the package is consumable
// via `npm install` from any registry client. If this fails, the publish has
// already shipped — fail the workflow loudly so a 0.x.y+1 patch can be cut.
//
// Input: PUBLISHED env var (JSON array from changesets/action publishedPackages
// output): [{ name, version }, ...]
//
// Exits 0 when every tarball is clean, 1 if any tarball has a leak or 404s.

import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { pipeline } from 'node:stream/promises'
import { createWriteStream } from 'node:fs'
import { request } from 'node:https'

const PROTOCOL_RE = /^(workspace|link|file|portal|catalog):/

function fetchTarball(tarballUrl, destPath) {
  return new Promise((resolve, reject) => {
    const req = request(tarballUrl, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        fetchTarball(res.headers.location, destPath).then(resolve, reject)
        return
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} fetching ${tarballUrl}`))
        return
      }
      pipeline(res, createWriteStream(destPath)).then(resolve, reject)
    })
    req.on('error', reject)
    req.end()
  })
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = request(url, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} fetching ${url}`))
        return
      }
      let data = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => (data += chunk))
      res.on('end', () => {
        try {
          resolve(JSON.parse(data))
        } catch (err) {
          reject(err)
        }
      })
    })
    req.on('error', reject)
    req.end()
  })
}

function extractTar(tarPath, destDir) {
  // --force-local prevents GNU tar from interpreting `C:\path` as `host:path`
  // when this script is run on Windows for local testing. On Ubuntu CI it's a
  // no-op. Without it, `mkdtemp` paths containing a drive letter break extraction.
  return new Promise((resolve, reject) => {
    const proc = spawn('tar', ['--force-local', '-xzf', tarPath, '-C', destDir], {
      stdio: 'inherit',
    })
    proc.on('error', reject)
    proc.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`tar exited ${code}`))))
  })
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

async function verifyOne(name, version) {
  const meta = await fetchJson(`https://registry.npmjs.org/${encodeURIComponent(name)}/${version}`)
  const tarballUrl = meta?.dist?.tarball
  if (!tarballUrl) throw new Error(`no tarball URL for ${name}@${version}`)
  const workDir = await mkdtemp(join(tmpdir(), 'mushi-verify-'))
  try {
    const tarPath = join(workDir, 'pkg.tgz')
    await fetchTarball(tarballUrl, tarPath)
    await extractTar(tarPath, workDir)
    const manifest = JSON.parse(await readFile(join(workDir, 'package', 'package.json'), 'utf8'))
    return collectLeaks(manifest)
  } finally {
    await rm(workDir, { recursive: true, force: true })
  }
}

async function main() {
  const raw = process.env.PUBLISHED
  if (!raw) {
    console.error('PUBLISHED env var is not set — nothing to verify')
    process.exit(1)
  }
  const packages = JSON.parse(raw)
  if (!Array.isArray(packages) || packages.length === 0) {
    console.log('No packages to verify.')
    return
  }

  const failures = []
  for (const { name, version } of packages) {
    try {
      const leaks = await verifyOne(name, version)
      if (leaks.length === 0) {
        console.log(`OK   ${name}@${version}`)
      } else {
        failures.push({ name, version, leaks })
        console.error(`FAIL ${name}@${version}`)
        for (const l of leaks) console.error(`     ${l.field}["${l.name}"] = "${l.spec}"`)
      }
    } catch (err) {
      failures.push({ name, version, error: err.message })
      console.error(`FAIL ${name}@${version} — ${err.message}`)
    }
  }

  if (failures.length > 0) {
    console.error(`\n${failures.length} package(s) failed verification. Cut a patch release.`)
    process.exit(1)
  }
  console.log(`\nAll ${packages.length} published tarball(s) verified clean.`)
}

main().catch((err) => {
  console.error('verify-published-tarballs crashed:', err)
  process.exit(2)
})
