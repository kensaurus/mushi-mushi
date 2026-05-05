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
 *      public --provenance=false` from that package's directory (the
 *      one containing its `package.json` — npm picks up the build
 *      output via the package's own `files` / `main` / `exports`
 *      fields). The script builds the workspace first to ensure the
 *      dist artefacts are fresh.
 *
 * Safety rails
 * ────────────
 * - Defaults to dry-run. Pass `--for-real` to actually publish.
 * - Skips any target whose current `package.json` version IS already
 *   present on the registry — i.e. re-running the script is a no-op
 *   once the package is bootstrapped.
 * - Refuses to publish anything outside the explicit `(path, name)`
 *   allowlist below. Both the path AND the package.json name must
 *   match — a renamed `package.json` will not silently slip through
 *   and accidentally publish under a different name.
 */

import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

// EXACTLY the set of packages that need the TP-bootstrap one-shot.
// Both the workspace path AND the package.json `name` are pinned so a
// renamed `package.json` can't sneak past the allowlist and end up
// publishing under a wrong name. Re-runs are safe — entries already
// on the registry are skipped silently.
//
// `mcp-ci` is NOT listed here: it already exists on npm, so the regular
// `release.yml` + a TP rule on its existing package settings page is
// the right path. Bootstrap is only for never-published packages.
const TARGETS = [
  { path: 'packages/inventory-schema', name: '@mushi-mushi/inventory-schema' },
  { path: 'packages/inventory-auth-runner', name: '@mushi-mushi/inventory-auth-runner' },
  { path: 'packages/eslint-plugin-mushi-mushi', name: 'eslint-plugin-mushi-mushi' },
]

// Strict semver-ish shape. Matches MAJOR.MINOR.PATCH plus optional
// prerelease (`-rc.1`) and build (`+sha.deadbeef`) tags. We use it to
// validate the version string read from package.json before letting it
// flow into a registry URL — anything outside this shape is rejected
// up front so an attacker who managed to plant a hostile package.json
// in the workspace can't smuggle path traversal or query injection
// through the version field.
const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/

function readPkg(rel) {
  const json = JSON.parse(readFileSync(resolve(ROOT, rel, 'package.json'), 'utf8'))
  const { name, version } = json
  if (typeof version !== 'string' || !SEMVER_RE.test(version)) {
    throw new Error(`${rel}/package.json: invalid version "${version}"`)
  }
  return { name, version }
}

async function npmRegistryHas(name, version) {
  // Avoid `npm view` because pnpm injects warning lines that mangle the
  // single-line output. Hit the registry directly via Node's native
  // fetch (Node 22+). The npm registry encodes scoped names by
  // percent-encoding the slash (`%40scope%2Fpkg`) — `encodeURIComponent`
  // produces exactly that, so we use it as-is. We use GET (matching
  // scripts/verify-published-tarballs.mjs); only the status code
  // matters here, so the response body is discarded.
  const url = `https://registry.npmjs.org/${encodeURIComponent(name)}/${encodeURIComponent(version)}`
  const res = await fetch(url, { method: 'GET' })
  if (res.status === 200) return true
  if (res.status === 404) return false
  throw new Error(`unexpected registry response for ${name}@${version}: HTTP ${res.status}`)
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: false, ...opts })
  // `spawnSync` failures fall into three buckets that we render distinctly
  // so an operator gets an actionable message instead of "exit null":
  //   1. `r.error` — process couldn't start (ENOENT etc.)
  //   2. `r.signal` — child was killed by a signal (SIGINT, SIGTERM)
  //   3. `r.status !== 0` — child exited with a non-zero code
  if (r.error) {
    throw new Error(`${cmd}: failed to start (${r.error.message})`)
  }
  if (r.signal) {
    throw new Error(`${cmd} ${args.join(' ')}: terminated by signal ${r.signal}`)
  }
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

  // Pre-flight: read each target's package.json AND verify the
  // declared name matches the allowlist. Mismatch is a fatal error —
  // we'd rather refuse to publish anything than silently publish a
  // renamed package under a name the operator didn't expect.
  //
  // After the equality check passes, we deliberately use the static
  // `target.name` literal (not the file-derived `name` value) when
  // building the registry URL. The two are provably equal at this
  // point, but using the literal makes the data flow explicit to
  // static analysis: the network call's host+path are sourced from
  // compile-time constants, not from untrusted file contents.
  const plan = []
  for (const target of TARGETS) {
    const { name, version } = readPkg(target.path)
    if (name !== target.name) {
      throw new Error(
        `allowlist mismatch: ${target.path}/package.json declares name "${name}" ` +
          `but the bootstrap allowlist expects "${target.name}". ` +
          `Update TARGETS deliberately if this is intentional.`,
      )
    }
    const onRegistry = await npmRegistryHas(target.name, version)
    plan.push({ rel: target.path, name: target.name, version, onRegistry })
    console.log(`  ${target.name}@${version}  ${onRegistry ? 'already on registry — SKIP' : 'NOT on registry — will publish'}`)
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

  // Stage a per-process npmrc inside a fresh temp directory and pass
  // it to `npm publish` via `NPM_CONFIG_USERCONFIG`. We deliberately
  // do NOT touch the user's real `~/.npmrc`:
  //
  //   - No backup/restore dance — there's nothing to roll back.
  //   - Two overlapping invocations can't clobber each other (each
  //     gets its own `mkdtempSync`-allocated directory).
  //   - SIGTERM / SIGHUP / unexpected aborts all leave the user's
  //     real npmrc untouched. The cleanup hooks below remove the
  //     temp dir as a best-effort housekeeping step; even if they
  //     don't fire (`SIGKILL`), the OS reaps `tmpdir()` eventually.
  //   - The auth-token file lives in `tmpdir()` with mode 0o600, never
  //     in $HOME and never in the workspace.
  const tempDir = mkdtempSync(join(tmpdir(), 'mushi-bootstrap-'))
  const tempNpmrc = join(tempDir, '.npmrc')
  let cleaned = false
  const cleanupTempDir = () => {
    if (cleaned) return
    try {
      rmSync(tempDir, { recursive: true, force: true })
      cleaned = true
    } catch (err) {
      // Don't mark as cleaned — a later exit hook may succeed.
      console.warn(
        `warn: failed to remove temp dir ${tempDir} (${err.message}). ` +
          `Delete it manually if it persists.`,
      )
    }
  }
  process.on('exit', cleanupTempDir)
  for (const sig of /** @type {const} */ (['SIGINT', 'SIGTERM', 'SIGHUP'])) {
    process.on(sig, () => {
      cleanupTempDir()
      // Conventional 128 + signal number for the common signals;
      // operators recognising 130/143/129 grep their CI logs faster.
      const code = sig === 'SIGINT' ? 130 : sig === 'SIGTERM' ? 143 : 129
      process.exit(code)
    })
  }

  writeFileSync(
    tempNpmrc,
    `//registry.npmjs.org/:_authToken=${token}\nregistry=https://registry.npmjs.org/\n`,
    { mode: 0o600 },
  )

  // `npm publish` honours `NPM_CONFIG_USERCONFIG` and treats the file
  // it points at as the user-level npmrc, fully overriding ~/.npmrc
  // for the duration of this child process.
  const publishEnv = { ...process.env, NPM_CONFIG_USERCONFIG: tempNpmrc }

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
        env: publishEnv,
        shell: process.platform === 'win32',
      })
      console.log(`✓ Published ${p.name}@${p.version}`)
    }
  } finally {
    cleanupTempDir()
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
