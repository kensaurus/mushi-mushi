#!/usr/bin/env node
/**
 * FILE: scripts/bootstrap-publish-new-packages.mjs
 *
 * One-shot publisher for packages that don't yet exist on npm.
 *
 * Why this script exists
 * ──────────────────────
 * npm's Trusted Publisher (OIDC) flow CANNOT publish the FIRST version
 * of a package — by their own admission. See npm/cli#8544
 * ("Allow publishing initial version with OIDC", maintainer reply
 *  Sep 2025: "We determined to not have 'first publish' available to
 *  limit scope in our MVP, but are evaluating options for the next
 *  step.").
 *
 * The TP UI on npmjs.com only lets you configure a Trusted Publisher
 * AFTER a package exists in the registry. So the only way to bootstrap
 * a brand-new `@mushi-mushi/*` package is:
 *
 *   1. Run this script ONCE locally (or in a one-shot manual workflow)
 *      with an `NPM_TOKEN` that has scope-create permissions, to publish
 *      the first version (without provenance — provenance requires OIDC).
 *
 *   2. On npmjs.com, configure the Trusted Publisher rule for each
 *      newly-created package:
 *        Repository:        kensaurus/mushi-mushi
 *        Workflow filename: release.yml
 *        Environment:       (leave blank)
 *
 *   3. Future versions auto-publish via the regular `release.yml` on
 *      changeset-merge — with provenance + Sigstore attestations from
 *      then on.
 *
 * Usage
 * ─────
 *   1. Get an npm token with create-package permission for the
 *      `@mushi-mushi` scope. The repo-level NPM_TOKEN GAT may not
 *      qualify (Granular tokens can only be granted to packages that
 *      already exist). Use a "Classic Automation" token, or a Granular
 *      token with explicit "Read and write" + "Selected scopes" scoping
 *      `@mushi-mushi`. For unscoped `eslint-plugin-mushi-mushi` add a
 *      package-name allowlist on the same token.
 *
 *   2. Export the token, then run:
 *        NPM_TOKEN=npm_… node scripts/bootstrap-publish-new-packages.mjs
 *
 *   3. The script will, for every target package whose current version
 *      is NOT yet present on the registry, run `npm publish --access
 *      public --provenance=false` from that package's dist directory.
 *      It builds the workspace first to ensure the dist artefacts are
 *      fresh.
 *
 * Safety rails
 * ────────────
 * - Defaults to dry-run. Pass `--for-real` to actually publish.
 * - Skips any target whose current `package.json` version IS already
 *   present on the registry — i.e. re-running the script is a no-op
 *   once the package is bootstrapped.
 * - Refuses to publish anything outside the four allowlisted targets
 *   below. Add new entries deliberately.
 */

import { readFileSync, writeFileSync, unlinkSync, existsSync, renameSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { homedir } from 'node:os'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

// EXACTLY the set of packages that need the TP-bootstrap one-shot.
// Re-runs are safe — entries that have already been published are
// skipped silently.
const TARGETS = [
  'packages/inventory-schema',
  'packages/inventory-auth-runner',
  'packages/eslint-plugin-mushi-mushi',
  // mcp-ci is NOT listed: it already exists on npm, so the regular
  // release.yml + a TP rule on its existing package settings page is
  // the right path. Bootstrap is only for never-published packages.
]

function readPkg(rel) {
  const json = JSON.parse(readFileSync(resolve(ROOT, rel, 'package.json'), 'utf8'))
  return { name: json.name, version: json.version }
}

async function npmRegistryHas(name, version) {
  // Avoid `npm view` because pnpm injects warning lines that mangle the
  // single-line output. Hit the registry directly via Node's native
  // fetch (Node 22+). HEAD on the version-specific URL returns 200 if
  // it exists, 404 otherwise — both are valid signals.
  const url = `https://registry.npmjs.org/${encodeURIComponent(name).replace(/%2F/g, '/')}/${encodeURIComponent(version)}`
  const res = await fetch(url, { method: 'GET' })
  if (res.status === 200) return true
  if (res.status === 404) return false
  throw new Error(`unexpected registry response for ${name}@${version}: HTTP ${res.status}`)
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: false, ...opts })
  if (r.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} failed (exit ${r.status})`)
  }
}

async function main() {
  const forReal = process.argv.includes('--for-real')
  const token = process.env.NPM_TOKEN
  if (forReal && !token) {
    console.error('error: NPM_TOKEN is not set. See script header for token requirements.')
    process.exit(2)
  }

  console.log(`bootstrap mode: ${forReal ? 'PUBLISH FOR REAL' : 'dry-run (pass --for-real to publish)'}`)
  console.log('')

  // Pre-flight: confirm every target has a build script and dist/.
  const plan = []
  for (const rel of TARGETS) {
    const { name, version } = readPkg(rel)
    const onRegistry = await npmRegistryHas(name, version)
    plan.push({ rel, name, version, onRegistry })
    console.log(`  ${name}@${version}  ${onRegistry ? 'already on registry — SKIP' : 'NOT on registry — will publish'}`)
  }

  const todo = plan.filter((p) => !p.onRegistry)
  if (todo.length === 0) {
    console.log('')
    console.log('All targets are already published. Nothing to do.')
    return
  }

  console.log('')
  if (!forReal) {
    console.log('Dry-run complete. Re-run with --for-real to publish.')
    return
  }

  // Build everything once before publishing — turbo handles incremental.
  console.log('Building workspace…')
  run('pnpm', ['-w', 'build'], { cwd: ROOT, shell: process.platform === 'win32' })

  // Stage a temporary `.npmrc` with the auth line, back up any existing
  // user `.npmrc`, restore on the way out. We deliberately use a
  // user-level npmrc (not project-level) so we don't accidentally
  // commit the auth line if the script is interrupted between publish
  // and cleanup. The token never gets written to a tracked file.
  const homeNpmrc = join(homedir(), '.npmrc')
  const backupPath = `${homeNpmrc}.mushi-bootstrap.bak`
  let restoredHome = false
  const restoreNpmrc = () => {
    if (restoredHome) return
    try {
      if (existsSync(backupPath)) {
        renameSync(backupPath, homeNpmrc)
      } else if (existsSync(homeNpmrc)) {
        unlinkSync(homeNpmrc)
      }
    } catch {
      /* best effort — instructions in handover doc cover manual cleanup */
    }
    restoredHome = true
  }
  process.on('exit', restoreNpmrc)
  process.on('SIGINT', () => {
    restoreNpmrc()
    process.exit(130)
  })

  if (existsSync(homeNpmrc)) {
    renameSync(homeNpmrc, backupPath)
  }
  writeFileSync(
    homeNpmrc,
    `//registry.npmjs.org/:_authToken=${token}\nregistry=https://registry.npmjs.org/\n`,
    { mode: 0o600 },
  )

  try {
    for (const p of todo) {
      console.log('')
      console.log(`Publishing ${p.name}@${p.version}…`)
      // First-publish without provenance. Provenance requires OIDC,
      // which we explicitly aren't using here. Subsequent publishes
      // from release.yml will get provenance automatically once the
      // TP rule is configured on npmjs.com.
      const cwd = resolve(ROOT, p.rel)
      run('npm', ['publish', '--access', 'public', '--provenance=false'], {
        cwd,
        shell: process.platform === 'win32',
      })
      console.log(`✓ Published ${p.name}@${p.version}`)
    }
  } finally {
    restoreNpmrc()
  }

  console.log('')
  console.log('Bootstrap complete.')
  console.log('')
  console.log('Next steps (manual, on npmjs.com):')
  for (const p of todo) {
    console.log(`  - Configure Trusted Publisher for ${p.name}:`)
    console.log(
      `      https://www.npmjs.com/package/${p.name}/access`,
    )
    console.log('      → Trusted Publisher → GitHub Actions →')
    console.log('        Repository: kensaurus/mushi-mushi')
    console.log('        Workflow:   release.yml')
    console.log('        Environment: (leave blank)')
  }
  console.log('')
  console.log('After the TP rules are set, the next changeset-merged release')
  console.log('publishes new versions of these packages via OIDC + provenance.')
}

main().catch((err) => {
  console.error('bootstrap failed:', err.message)
  process.exit(1)
})
