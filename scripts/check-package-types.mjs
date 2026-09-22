#!/usr/bin/env node
/**
 * FILE: scripts/check-package-types.mjs
 * PURPOSE: Check the TYPES of the tarballs we publish, not of the source tree.
 *
 * `pnpm typecheck` compiles src/ against src/. What a consumer gets is the
 * packed tarball resolved through package.json `exports` under their own
 * moduleResolution — and that is where the published bugs were: ESM types
 * served to CommonJS consumers ("masquerading as ESM"), subpaths that
 * `moduleResolution: node` cannot see. Are The Types Wrong
 * (@arethetypeswrong/cli, root devDependency) resolves every entry point of a
 * tarball under node10, node16-CJS, node16-ESM and bundler and reports each
 * mismatch.
 *
 * Each package is packed with `pnpm pack` (as the release does) and checked
 * with the profile below. A profile other than `strict` names the resolution
 * mode the package deliberately does not support — tighten it when that
 * changes, never loosen it to get a run green.
 *
 * Run after the packages are built:  node scripts/check-package-types.mjs
 */

import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { packPackage } from './lib/pack.mjs'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')

export const PACKAGES = [
  { dir: 'packages/core', profile: 'strict' },
  { dir: 'packages/web', profile: 'strict' },
  { dir: 'packages/react', profile: 'strict' },
  {
    dir: 'packages/node',
    // ./express, ./fastify and ./hono have no typesVersions fallback, so a
    // consumer on `moduleResolution: "node"` (node10) cannot import them.
    // Move to `strict` once packages/node/package.json maps them the way
    // packages/web does.
    profile: 'node16',
  },
  // ESM-only by design (`"type": "module"`, no `require` condition): a
  // CommonJS consumer must use a dynamic import, which attw reports under
  // node16-CJS unless told the package is ESM-only.
  { dir: 'packages/mcp', profile: 'esm-only' },
  { dir: 'packages/cli', profile: 'esm-only' },
]

function attwBin() {
  const require = createRequire(join(ROOT, 'package.json'))
  const pkgJson = require.resolve('@arethetypeswrong/cli/package.json')
  const { bin } = JSON.parse(readFileSync(pkgJson, 'utf8'))
  return join(dirname(pkgJson), typeof bin === 'string' ? bin : bin.attw)
}

function main() {
  const bin = attwBin()
  const dest = mkdtempSync(join(tmpdir(), 'mushi-attw-'))
  const failed = []
  try {
    for (const { dir, profile } of PACKAGES) {
      const { name } = JSON.parse(readFileSync(join(ROOT, dir, 'package.json'), 'utf8'))
      const tgz = packPackage(join(ROOT, dir), dest)
      console.log(`\n── ${name} (profile: ${profile}) ──`)
      // --no-definitely-typed: never fetch @types from the registry; every
      // package here ships its own declarations.
      const res = spawnSync(
        process.execPath,
        [bin, tgz, '--profile', profile, '--format', 'ascii', '--no-color', '--no-definitely-typed'],
        { stdio: 'inherit' },
      )
      if (res.status !== 0) failed.push(`${name} (exit ${res.status ?? res.signal})`)
    }
  } finally {
    rmSync(dest, { recursive: true, force: true })
  }
  if (failed.length > 0) {
    console.error(`\ncheck-package-types: published types are wrong for ${failed.join(', ')} — see the tables above.`)
    console.error('Problem docs: https://github.com/arethetypeswrong/arethetypeswrong.github.io/tree/main/docs/problems')
    return 1
  }
  console.log(`\ncheck-package-types: ${PACKAGES.length} tarball(s) resolve correctly under their profiles ✓`)
  return 0
}

function isEntryScript() {
  if (!process.argv[1]) return false
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return import.meta.url === pathToFileURL(process.argv[1]).href
  }
}

if (isEntryScript()) process.exitCode = main()
