#!/usr/bin/env node
/**
 * bootstrap-new-packages.mjs
 *
 * PROBLEM: With NPM_CONFIG_PROVENANCE=true, npm's OIDC Trusted Publisher
 * handshake requires a Trusted Publisher rule to be pre-configured on
 * npmjs.com for EACH package. For brand-new packages (not yet in the npm
 * registry), this rule doesn't exist yet — the OIDC exchange fails and
 * npm returns a misleading 404.
 *
 * SOLUTION: Before the main `changeset publish` step, detect any publishable
 * packages that do not yet exist in the registry, build them, and publish
 * them with NPM_TOKEN (no provenance). Once the package exists on npm, a
 * Trusted Publisher rule can be created via the npmjs.com UI, and future
 * releases will go through the normal OIDC-provenance path.
 *
 * After this script runs, `changeset publish` will see these packages are
 * already at their current version and skip them (the "already published"
 * warning). The release overall still succeeds.
 *
 * WHERE IT RUNS: .github/workflows/npm-bootstrap.yml (manual, behind the
 * `npm-bootstrap` environment) — NOT the Release workflow. release.yml holds
 * `id-token: write` and is the workflow npm's Trusted Publisher rules trust,
 * so it must not also hold a long-lived publish token. release.yml runs this
 * script with --check instead, which needs no token and fails the release
 * before `changeset publish` if a package still has to be bootstrapped.
 *
 * USAGE:
 *   node scripts/bootstrap-new-packages.mjs           # publish new packages
 *   node scripts/bootstrap-new-packages.mjs --check   # list them, exit 1 if any
 *
 * REQUIREMENTS (publish mode):
 *   - NODE_AUTH_TOKEN env var must be set (NPM_TOKEN with write access)
 *   - pnpm turbo run build must have already run
 *   - cwd = repo root
 *
 * EXIT CODE:
 *   0 — success (no new packages, or all new packages published)
 *   1 — one or more new packages failed to publish (or, with --check, exist)
 */

import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const PUBLISH_ROOTS = ['packages']

const checkOnly = process.argv.includes('--check')
const token = process.env.NODE_AUTH_TOKEN
if (!checkOnly && !token) {
  console.log('bootstrap-new-packages: NODE_AUTH_TOKEN not set — skipping (provenance mode)')
  process.exit(0)
}

/** Walk a directory, yielding every package.json (skipping node_modules/dist). */
function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === '.turbo') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) yield* walk(full)
    else if (entry === 'package.json') yield full
  }
}

/**
 * Check whether the package name already exists on npm. Reads the public
 * registry directly (no npm CLI, no auth), so --check works in a job whose
 * .npmrc only carries setup-node's placeholder token.
 */
async function packageExistsOnNpm(name) {
  const url = `https://registry.npmjs.org/${name.replaceAll('/', '%2f')}`
  let last = ''
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { accept: 'application/vnd.npm.install-v1+json' } })
      await res.body?.cancel()
      if (res.status === 200) return true
      if (res.status === 404) return false
      last = `HTTP ${res.status}`
    } catch (err) {
      last = err instanceof Error ? err.message : String(err)
    }
    await new Promise((resolve) => setTimeout(resolve, attempt * 2000))
  }
  // Only a definite 404 means "new". A registry hiccup must not block a
  // release over 33 lookups; a package that really is new still fails loudly
  // at the OIDC publish.
  console.log(`::warning::could not confirm ${name} on npm (${last}); assuming it exists`)
  return true
}

async function shouldBootstrapPackage(pkg) {
  return !(await packageExistsOnNpm(pkg.name))
}

// Collect publishable package names that are NOT on npm yet.
const newPackages = []
for (const root of PUBLISH_ROOTS) {
  const absRoot = join(ROOT, root)
  try { statSync(absRoot) } catch { continue }
  for (const pkgPath of walk(absRoot)) {
    let pkg
    try { pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) } catch { continue }
    if (pkg.private === true) continue
    if (!pkg.version) continue
    if (!pkg.name?.match(/^(@[a-z0-9-]+\/)?[a-z0-9-]+/)) continue
    if (!(await shouldBootstrapPackage(pkg))) continue
    newPackages.push({ pkgPath, pkg, dir: join(pkgPath, '..') })
  }
}

if (newPackages.length === 0) {
  console.log('bootstrap-new-packages: all publishable packages already exist on npm.')
  process.exit(0)
}

if (checkOnly) {
  for (const { pkg } of newPackages) {
    console.log(`::error::${pkg.name} is not on npm yet, so the OIDC publish in release.yml cannot create it.`)
  }
  console.log(
    'Run the "npm Bootstrap" workflow (npm-bootstrap.yml), add a Trusted Publisher rule for each ' +
      'package on npmjs.com pointing at release.yml, then re-run the release.',
  )
  process.exit(1)
}

console.log(`bootstrap-new-packages: ${newPackages.length} new package(s) to bootstrap without provenance:`)
for (const { pkg } of newPackages) {
  console.log(`  ${pkg.name}@${pkg.version}`)
}

let failed = 0
for (const { pkg, dir } of newPackages) {
  console.log(`\n→ Publishing ${pkg.name}@${pkg.version} (no provenance)...`)
  try {
    // MUST use `pnpm publish`, not bare `npm publish`. npm does not rewrite
    // `workspace:^` / `workspace:*` specifiers — @mushi-mushi/mcp@0.10.0 shipped
    // with `"@mushi-mushi/core": "workspace:^"` and broke `npx @mushi-mushi/mcp`.
    execFileSync(
      'pnpm',
      ['publish', '--access', 'public', '--no-git-checks', '--provenance=false'],
      {
        cwd: dir,
        stdio: 'pipe',
        env: {
          ...process.env,
          NODE_AUTH_TOKEN: token,
          NPM_CONFIG_PROVENANCE: 'false',
        },
        shell: true,
      },
    )
    console.log(`  ✓ Published ${pkg.name}@${pkg.version}`)
    console.log(`    NOTE: set up a Trusted Publisher rule on npmjs.com for ${pkg.name}`)
    console.log(`    (https://www.npmjs.com/package/${pkg.name}) → Package Settings → Trusted Publishers`)
  } catch (err) {
    const stderr = err.stderr?.toString() ?? ''
    const stdout = err.stdout?.toString() ?? ''
    console.error(`  ✗ Failed to publish ${pkg.name}@${pkg.version}:`)
    console.error(stderr || stdout)
    failed++
  }
}

if (failed > 0) {
  console.error(`\nbootstrap-new-packages: ${failed} package(s) failed. Fix and re-run.`)
  process.exit(1)
}

console.log('\nbootstrap-new-packages: all new packages bootstrapped successfully.')
