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
// REGISTRY PROPAGATION: a version `changeset publish` just pushed can 404 on
// the registry for minutes. Release run 34745513175 failed here with
// "HTTP 404" for four versions that resolved fine shortly after, and the
// failure skipped every post-publish step behind it. Each package is now
// retried with capped exponential backoff (~5.5 min worst case) on 404, 408,
// 429, 5xx, timeouts and connection errors, and packages are verified in
// parallel so the window does not multiply. A leak is never retried.
//
// Input: PUBLISHED env var (JSON array from changesets/action publishedPackages
// output): [{ name, version }, ...]
//
// Exits 0 when every tarball is clean, 1 if any tarball has a leak or never
// appears on the registry.

import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { pipeline } from 'node:stream/promises'
import { createWriteStream } from 'node:fs'
import { request } from 'node:https'
import { pathToFileURL } from 'node:url'

const PROTOCOL_RE = /^(workspace|link|file|portal|catalog):/
const REQUEST_TIMEOUT_MS = 30_000

export const RETRY_DEFAULTS = Object.freeze({ attempts: 10, baseDelayMs: 3_000, maxDelayMs: 60_000 })

/** An HTTP failure; `retryable` marks the statuses registry propagation produces. */
export class HttpError extends Error {
  constructor(status, url) {
    super(`HTTP ${status} fetching ${url}`)
    this.status = status
    this.retryable = status === 404 || status === 408 || status === 429 || status >= 500
  }
}

function transportError(err) {
  const wrapped = err instanceof Error ? err : new Error(String(err))
  wrapped.retryable = true
  return wrapped
}

/** Delay before retry number `attempt` (1-based): base·2^(attempt-1), capped. */
export function backoffDelay(attempt, { baseDelayMs, maxDelayMs } = RETRY_DEFAULTS) {
  return Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs)
}

/**
 * Run `operation` until it succeeds, throws a non-retryable error, or runs
 * out of attempts. `sleep` and `onRetry` are injectable for tests.
 */
export async function withRetry(
  operation,
  {
    attempts = RETRY_DEFAULTS.attempts,
    baseDelayMs = RETRY_DEFAULTS.baseDelayMs,
    maxDelayMs = RETRY_DEFAULTS.maxDelayMs,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    onRetry = () => {},
  } = {},
) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await operation(attempt)
    } catch (err) {
      if (!err?.retryable || attempt >= attempts) throw err
      const delay = backoffDelay(attempt, { baseDelayMs, maxDelayMs })
      onRetry(err, attempt, delay)
      await sleep(delay)
    }
  }
}

function fetchTarball(tarballUrl, destPath) {
  return new Promise((resolve, reject) => {
    const req = request(tarballUrl, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        res.resume()
        fetchTarball(res.headers.location, destPath).then(resolve, reject)
        return
      }
      if (res.statusCode !== 200) {
        res.resume()
        reject(new HttpError(res.statusCode, tarballUrl))
        return
      }
      pipeline(res, createWriteStream(destPath)).then(resolve, (err) => reject(transportError(err)))
    })
    req.setTimeout(REQUEST_TIMEOUT_MS, () => req.destroy(new Error(`timeout fetching ${tarballUrl}`)))
    req.on('error', (err) => reject(transportError(err)))
    req.end()
  })
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = request(url, (res) => {
      if (res.statusCode !== 200) {
        res.resume()
        reject(new HttpError(res.statusCode, url))
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
    req.setTimeout(REQUEST_TIMEOUT_MS, () => req.destroy(new Error(`timeout fetching ${url}`)))
    req.on('error', (err) => reject(transportError(err)))
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

export function collectLeaks(pkg) {
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

/**
 * Verify every package (in parallel, each with its own retry budget).
 * Resolves to the failures: `{ name, version, leaks }` or `{ name, version, error }`.
 */
export async function verifyPackages(packages, { verify = verifyOne, retry = {}, log = console } = {}) {
  const results = await Promise.all(
    packages.map(async (pkg) => {
      // The list comes from the PUBLISHED env var, so every logged field is
      // flattened to one line before any log call can see it.
      const name = String(pkg.name).replace(/[\r\n]+/g, ' ')
      const version = String(pkg.version).replace(/[\r\n]+/g, ' ')
      try {
        const leaks = await withRetry(() => verify(name, version), {
          ...retry,
          onRetry: (err, attempt, delay) =>
            log.log(`WAIT ${name}@${version} — ${String(err.message).replace(/[\r\n]+/g, ' ')}; retry ${attempt} in ${Math.round(delay / 1000)}s`),
        })
        if (leaks.length === 0) {
          log.log(`OK   ${name}@${version}`)
          return null
        }
        log.error(`FAIL ${name}@${version}`)
        for (const l of leaks) log.error(`     ${l.field}["${l.name}"] = "${l.spec}"`)
        return { name, version, leaks }
      } catch (err) {
        // One line per failure: a registry error body must not forge log lines.
        log.error(`FAIL ${name}@${version} — ${String(err.message).replace(/[\r\n]+/g, ' ')}`)
        return { name, version, error: err.message }
      }
    }),
  )
  return results.filter(Boolean)
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

  const failures = await verifyPackages(packages)
  if (failures.length > 0) {
    console.error(`\n${failures.length} package(s) failed verification. Cut a patch release.`)
    process.exit(1)
  }
  console.log(`\nAll ${packages.length} published tarball(s) verified clean.`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error('verify-published-tarballs crashed:', err)
    process.exit(2)
  })
}
