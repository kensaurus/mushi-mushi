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
 * USAGE (called by release.yml before the changesets step):
 *   node scripts/bootstrap-new-packages.mjs
 *
 * REQUIREMENTS:
 *   - NODE_AUTH_TOKEN env var must be set (NPM_TOKEN with write access)
 *   - pnpm turbo run build must have already run
 *   - cwd = repo root
 *
 * EXIT CODE:
 *   0 — success (no new packages, or all new packages published)
 *   1 — one or more new packages failed to publish
 */

import { execSync, execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const PUBLISH_ROOTS = ['packages']
const NPM_BIN = process.platform === 'win32' ? 'npm.cmd' : 'npm'

const token = process.env.NODE_AUTH_TOKEN
if (!token) {
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

/** Check whether the package name already exists on npm. */
function packageExistsOnNpm(name) {
  try {
    execFileSync(NPM_BIN, ['view', name, 'name'], {
      stdio: 'pipe',
      env: { ...process.env },
    })
    return true
  } catch (err) {
    const output = `${err.stdout?.toString?.() ?? ''}\n${err.stderr?.toString?.() ?? ''}`
    if (/E404|404 Not Found|is not in this registry/i.test(output)) {
      return false
    }
    throw new Error(`npm view ${name} failed while checking package existence:\n${output.trim()}`)
  }
}

function shouldBootstrapPackage(pkg) {
  try {
    return !packageExistsOnNpm(pkg.name)
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  }
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
    if (!shouldBootstrapPackage(pkg)) continue
    newPackages.push({ pkgPath, pkg, dir: join(pkgPath, '..') })
  }
}

if (newPackages.length === 0) {
  console.log('bootstrap-new-packages: all publishable packages already exist on npm.')
  process.exit(0)
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
