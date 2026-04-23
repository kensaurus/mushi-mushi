#!/usr/bin/env node
/**
 * check-publish-readiness.mjs
 *
 * Pre-release gate: every package that is intended for npm publishing
 * must have the canonical fields set correctly in its `package.json`.
 * Motivated by the 2026-04-21 audit — `@mushi-mushi/verify` shipped with
 * `files` missing `LICENSE`, and `@mushi-mushi/launcher` had
 * `repository.directory` pointing at the wrong folder.
 *
 * Rules enforced (per publishable package):
 *   - `name`           ∈ '@mushi-mushi/*'
 *   - `version`        matches semver
 *   - `license`        set (MIT or "SEE LICENSE IN …")
 *   - `engines.node`   declared (workspace convention: ">=20")
 *   - `repository`     { type: 'git', url: '…', directory: '<matches folder>' }
 *   - `files`          non-empty, includes README + LICENSE
 *   - `exports`        declared OR `main`+`types` declared
 *   - `publishConfig.access` === 'public'
 *
 * A package opts out by setting `"private": true` in its package.json
 * (tests, examples, tooling glue). The script surfaces every violation
 * instead of failing on the first one so ops can fix them in a single
 * round-trip.
 *
 * Exits with code 1 on any violation so CI and git hooks can gate on it.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = process.cwd()
const PUBLISH_ROOTS = ['packages']

const violations = []

/** Walk a directory, returning every `package.json` (skipping node_modules/dist). */
function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === '.turbo') continue
    const full = join(dir, entry)
    const s = statSync(full)
    if (s.isDirectory()) {
      yield* walk(full)
    } else if (entry === 'package.json') {
      yield full
    }
  }
}

function addViolation(pkgPath, rule, detail) {
  violations.push({ pkg: relative(ROOT, pkgPath), rule, detail })
}

for (const root of PUBLISH_ROOTS) {
  const absRoot = join(ROOT, root)
  try { statSync(absRoot) } catch { continue }

  for (const pkgPath of walk(absRoot)) {
    let pkg
    try {
      pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
    } catch (err) {
      addViolation(pkgPath, 'parse', `Invalid JSON: ${err.message}`)
      continue
    }
    if (pkg.private === true) continue // opt-out

    // ------- name
    //   `@mushi-mushi/*` for the SDK/server/plugin constellation, plus two
    //   unscoped exceptions for the public-facing CLI entry points that
    //   users actually type on the command line (`mushi-mushi`,
    //   `create-mushi-mushi`). Those two names are owned by the org and
    //   have been the launch-day brand since v0.1.0 — re-scoping them would
    //   break every documented install line.
    const UNSCOPED_ALLOWED = new Set(['mushi-mushi', 'create-mushi-mushi'])
    if (
      typeof pkg.name !== 'string' ||
      (!pkg.name.startsWith('@mushi-mushi/') && !UNSCOPED_ALLOWED.has(pkg.name))
    ) {
      addViolation(pkgPath, 'name', `Must be @mushi-mushi/* or ${[...UNSCOPED_ALLOWED].join('/')}, got "${pkg.name}"`)
    }

    // ------- version
    if (!/^\d+\.\d+\.\d+(?:-[\w.]+)?$/.test(pkg.version ?? '')) {
      addViolation(pkgPath, 'version', `Not semver: "${pkg.version}"`)
    }

    // ------- license
    if (!pkg.license || typeof pkg.license !== 'string') {
      addViolation(pkgPath, 'license', 'Missing `license` field')
    }

    // ------- engines.node
    if (!pkg.engines || typeof pkg.engines.node !== 'string') {
      addViolation(pkgPath, 'engines.node', 'Missing `engines.node`. Convention: ">=20"')
    }

    // ------- repository
    if (!pkg.repository || typeof pkg.repository !== 'object') {
      addViolation(pkgPath, 'repository', 'Missing `repository` object')
    } else {
      if (pkg.repository.type !== 'git') {
        addViolation(pkgPath, 'repository.type', `Must be "git", got ${JSON.stringify(pkg.repository.type)}`)
      }
      if (typeof pkg.repository.url !== 'string') {
        addViolation(pkgPath, 'repository.url', 'Missing `repository.url`')
      }
      const expectedDir = relative(ROOT, pkgPath).replace(/\\/g, '/').replace(/\/package\.json$/, '')
      if (pkg.repository.directory !== expectedDir) {
        addViolation(
          pkgPath,
          'repository.directory',
          `Expected "${expectedDir}", got ${JSON.stringify(pkg.repository.directory)}`,
        )
      }
    }

    // ------- files
    if (!Array.isArray(pkg.files) || pkg.files.length === 0) {
      addViolation(pkgPath, 'files', '`files` must be a non-empty array')
    } else {
      const hasReadme = pkg.files.some((f) => /^README(\.md)?$/i.test(f))
      const hasLicense = pkg.files.some((f) => /^LICENSE(\.(md|txt))?$/i.test(f))
      if (!hasReadme) addViolation(pkgPath, 'files.readme', '`files` must include README')
      if (!hasLicense) addViolation(pkgPath, 'files.license', '`files` must include LICENSE')
    }

    // ------- exports / main
    //   Pure CLI packages (no library surface, only `bin`) legitimately
    //   have neither `exports` nor `main` — `mushi-mushi` and
    //   `create-mushi-mushi` fall in that bucket. Skip the check when
    //   `bin` is the only entry the package exposes.
    const hasExports = pkg.exports && typeof pkg.exports === 'object'
    const hasMain = typeof pkg.main === 'string' || typeof pkg.module === 'string'
    const hasTypes = typeof pkg.types === 'string'
    const isBinOnly = !!pkg.bin && !hasExports && !hasMain
    if (!isBinOnly && !hasExports && !(hasMain && hasTypes)) {
      addViolation(pkgPath, 'exports', 'Must declare `exports` OR both `main`/`module` and `types`')
    }

    // ------- publishConfig
    if (!pkg.publishConfig || pkg.publishConfig.access !== 'public') {
      addViolation(pkgPath, 'publishConfig.access', '`publishConfig.access` must be "public"')
    }
  }
}

if (violations.length > 0) {
  console.error(`\nPublish readiness check found ${violations.length} violation(s):\n`)
  for (const v of violations) {
    console.error(`  [${v.rule}] ${v.pkg}`)
    console.error(`    → ${v.detail}`)
  }
  console.error('\nFix the above before running `pnpm release`.\n')
  process.exit(1)
}

console.log('OK: publish readiness — all publishable packages pass the gate.')
