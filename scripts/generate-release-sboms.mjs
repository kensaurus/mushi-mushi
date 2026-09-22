#!/usr/bin/env node
/**
 * FILE: scripts/generate-release-sboms.mjs
 * PURPOSE: A CycloneDX SBOM for every package a release published, built from
 *          the tarball npm now serves — not from the workspace.
 *
 * For each { name, version } in PUBLISHED (changesets' publishedPackages):
 *   1. `npm pack <name>@<version>` downloads the published tarball (retried
 *      while the registry propagates a just-published version)
 *   2. unpack it and drop `devDependencies` from the copy's package.json —
 *      they are not installed by consumers and include workspace-only
 *      packages that do not exist on npm
 *   3. `npm install --omit=dev --ignore-scripts` resolves the dependency tree
 *      a consumer would get today
 *   4. `npm sbom --sbom-format cyclonedx --sbom-type library --omit dev`
 * `npm sbom` is built into npm (no extra tool). It refuses a pnpm workspace
 * tree (no npm lockfile, symlinked node_modules), which is why each SBOM is
 * made from the unpacked tarball instead.
 *
 * Writes <out>/<name>-<version>.cdx.json per package and <out>/index.json
 * mapping each file to its package, name and version (release.yml attaches
 * each file to that package's GitHub release, tag `<name>@<version>`).
 *
 * Usage:
 *   PUBLISHED='[{"name":"@mushi-mushi/core","version":"1.28.0"}]' \
 *     node scripts/generate-release-sboms.mjs sbom
 * Exit 1 if any package's SBOM could not be produced (the others are still written).
 */

import { execSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { extractTarball } from './lib/pack.mjs'

const out = resolve(process.argv[2] ?? 'sbom')
let published
try {
  published = JSON.parse(process.env.PUBLISHED || '[]')
} catch {
  console.error('generate-release-sboms: PUBLISHED is not valid JSON')
  process.exit(2)
}
if (!Array.isArray(published) || published.length === 0) {
  console.log('generate-release-sboms: nothing published; no SBOMs to write.')
  process.exit(0)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const run = (cmd, cwd) => execSync(cmd, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 })

/** `npm pack name@version`, retrying the post-publish propagation window. */
async function packFromRegistry(spec, cwd) {
  let delay = 2000
  for (let attempt = 1; ; attempt++) {
    try {
      return run(`npm pack "${spec}" --silent`, cwd).trim().split(/\r?\n/).pop()
    } catch (err) {
      const text = `${err.stdout ?? ''}${err.stderr ?? ''}`
      if (attempt >= 7 || !/ETARGET|E404|No matching version|404 Not Found/.test(text)) throw new Error(text.trim() || String(err))
      console.log(`  … ${spec} not on the registry yet (attempt ${attempt}/7); retrying in ${delay / 1000}s`)
      await sleep(delay)
      delay *= 2
    }
  }
}

/** `@mushi-mushi/react` → { group: '@mushi-mushi', name: 'react' } */
function splitName(pkgName) {
  const m = pkgName.match(/^(@[^/]+)\/(.+)$/)
  return m ? { group: m[1], name: m[2] } : { group: undefined, name: pkgName }
}

mkdirSync(out, { recursive: true })
const index = []
const failed = []

for (const { name, version } of published) {
  const spec = `${name}@${version}`
  const work = mkdtempSync(join(tmpdir(), 'mushi-sbom-'))
  try {
    console.log(`SBOM for ${spec}`)
    const tgz = await packFromRegistry(spec, work)
    const unpacked = join(work, 'unpacked')
    mkdirSync(unpacked)
    extractTarball(readFileSync(join(work, tgz)), unpacked)
    const pkgDir = join(unpacked, readdirSync(unpacked)[0])
    const manifestPath = join(pkgDir, 'package.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    delete manifest.devDependencies
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
    run('npm install --omit=dev --ignore-scripts --no-audit --no-fund', pkgDir)
    const sbom = JSON.parse(run('npm sbom --sbom-format cyclonedx --sbom-type library --omit dev', pkgDir))
    // npm names the root component after the folder it ran in ("package").
    Object.assign(sbom.metadata.component, splitName(name))
    const file = `${name.replace(/^@/, '').replace(/\//g, '-')}-${version}.cdx.json`
    writeFileSync(join(out, file), `${JSON.stringify(sbom, null, 2)}\n`)
    index.push({ file, name, version, tag: spec, components: sbom.components?.length ?? 0 })
    console.log(`  ✓ ${file} (${sbom.components?.length ?? 0} components)`)
  } catch (err) {
    failed.push(spec)
    console.error(`  ✗ ${spec}: ${String(err.message ?? err).slice(0, 2000)}`)
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

writeFileSync(join(out, 'index.json'), `${JSON.stringify(index, null, 2)}\n`)
if (failed.length > 0) {
  console.error(`\ngenerate-release-sboms: no SBOM for ${failed.join(', ')}`)
  process.exit(1)
}
console.log(`\ngenerate-release-sboms: ${index.length} SBOM(s) in ${out}`)
