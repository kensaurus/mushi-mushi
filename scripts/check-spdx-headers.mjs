#!/usr/bin/env node
/**
 * FILE: scripts/check-spdx-headers.mjs
 * PURPOSE: Verify that every source file a published package ships as an entry
 *          point carries an SPDX license identifier that matches the package's
 *          `license` field, making attribution explicit in every copy.
 *
 * USAGE:
 *   node scripts/check-spdx-headers.mjs   # exits 0 = pass, 1 = fail
 *
 * WHAT COUNTS AS AN ENTRY POINT
 *   Every JavaScript file a consumer can reach through the manifest: `main`,
 *   `module`, `browser`, `unpkg`, `jsdelivr`, every `bin`, and every leaf of
 *   `exports` (type declarations, CSS and JSON are skipped). Each `dist/<name>`
 *   target is mapped back to its source through the package's tsup `entry`
 *   (object keys name the output; array entries are named relative to their
 *   common directory, as esbuild does), falling back to `src/<name>.<ext>`.
 *   Until 2026-09 this only looked at src/index.ts, so subpath exports
 *   (`@mushi-mushi/node/express`), bins (`mushi-mcp`) and the CDN loader
 *   shipped without the check ever reading them.
 *
 *   A target that maps to no source file fails: a check that cannot find the
 *   file it guards must not pass. A target whose source exists but that no
 *   tsup entry builds is reported as a warning — the tarball will not contain
 *   it (see the report for @mushi-mushi/adapters).
 *
 * Only packages that publish (a `publishConfig` and not `private`) are checked.
 */
import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs'
import { join, dirname, posix } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PACKAGES_DIR = join(ROOT, 'packages')
const SPDX_RE = /^\s*\/\/\s*SPDX-License-Identifier:\s*(\S+)/m
const JS_TARGET = /\.(?:global\.js|iife\.js|m?js|cjs)$/
const SOURCE_EXTS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.jsx']
const MANIFEST_FIELDS = ['main', 'module', 'browser', 'unpkg', 'jsdelivr']

// Entry sources known to lack a header when the check was widened, left for
// the next change to their package rather than edited alongside it. Printed on
// every run. An entry that gains its header (or stops being an entry) fails as
// stale, so this list can only shrink — never add to it to get a run green.
const KNOWN_MISSING = new Set([
  'packages/mcp/src/branding.ts',
  'packages/mcp/src/catalog.ts',
  'packages/mcp/src/clients.ts',
  'packages/mcp/src/feature-groups.ts',
  'packages/mcp/src/server.ts',
])

/** Every string leaf of an `exports` value (conditions and subpaths). */
function exportLeaves(value, out) {
  if (typeof value === 'string') out.push(value)
  else if (Array.isArray(value)) for (const v of value) exportLeaves(v, out)
  else if (value && typeof value === 'object') for (const v of Object.values(value)) exportLeaves(v, out)
  return out
}

/**
 * JavaScript files a consumer can load from this manifest, as package-relative
 * paths without a leading `./` (e.g. `dist/express.cjs`).
 * @param {Record<string, unknown>} pkg
 * @returns {string[]}
 */
export function distTargets(pkg) {
  const raw = []
  for (const field of MANIFEST_FIELDS) if (typeof pkg[field] === 'string') raw.push(pkg[field])
  if (typeof pkg.bin === 'string') raw.push(pkg.bin)
  else if (pkg.bin && typeof pkg.bin === 'object') raw.push(...Object.values(pkg.bin))
  if (pkg.exports !== undefined) exportLeaves(pkg.exports, raw)
  const out = new Set()
  for (const r of raw) {
    if (typeof r !== 'string') continue
    const rel = r.replace(/^\.\//, '')
    if (/\.d\.[cm]?ts$/.test(rel) || !JS_TARGET.test(rel)) continue
    out.add(rel)
  }
  return [...out].sort()
}

function commonDir(paths) {
  const dirs = paths.map((p) => posix.dirname(p).split('/'))
  const first = dirs[0] ?? []
  let n = first.length
  for (const d of dirs.slice(1)) {
    let i = 0
    while (i < n && i < d.length && d[i] === first[i]) i++
    n = i
  }
  return first.slice(0, n).join('/')
}

/**
 * Output name → source path for every `entry` in a tsup config. Handles the
 * two shapes the repo uses: `entry: ['src/a.ts', …]` and
 * `entry: { name: 'src/a.ts', 'dotted.name': 'src/b.ts' }`, across one or more
 * config objects.
 * @param {string} text tsup.config.ts source
 * @returns {Map<string, string>}
 */
export function parseTsupEntries(text) {
  const map = new Map()
  for (const m of text.matchAll(/\bentry\s*:\s*(\[[^\]]*\]|\{[^}]*\})/g)) {
    const block = m[1]
    if (block.startsWith('[')) {
      const files = [...block.matchAll(/['"`]([^'"`]+)['"`]/g)].map((x) => x[1])
      if (files.length === 0) continue
      const base = commonDir(files)
      for (const f of files) {
        const rel = base ? posix.relative(base, f) : f
        map.set(rel.replace(/\.[^./]+$/, ''), f)
      }
    } else {
      for (const pair of block.matchAll(/(?:['"`]([^'"`]+)['"`]|([\w$-]+))\s*:\s*['"`]([^'"`]+)['"`]/g)) {
        map.set(pair[1] ?? pair[2], pair[3])
      }
    }
  }
  return map
}

/**
 * @param {string} target e.g. `dist/express.cjs`
 * @param {Map<string, string>} entries from parseTsupEntries
 * @param {(rel: string) => boolean} exists package-relative existence check
 * @returns {{ source: string | null, built: boolean }}
 */
export function resolveSource(target, entries, exists) {
  if (!target.startsWith('dist/')) return { source: null, built: false }
  const name = target.slice('dist/'.length).replace(JS_TARGET, '')
  const mapped = entries.get(name)
  if (mapped) return { source: mapped.replace(/^\.\//, ''), built: true }
  for (const ext of SOURCE_EXTS) {
    for (const candidate of [`src/${name}${ext}`, `src/${name}/index${ext}`]) {
      if (exists(candidate)) return { source: candidate, built: entries.size === 0 }
    }
  }
  return { source: null, built: false }
}

/** The identifier a source file must carry, or null when the manifest has none. */
export function expectedIdentifier(pkg) {
  return typeof pkg.license === 'string' ? pkg.license : null
}

function main() {
  const failures = []
  const warnings = []
  const known = []
  const seenKnown = new Set()
  let checked = 0

  for (const name of readdirSync(PACKAGES_DIR).sort()) {
    const pkgDir = join(PACKAGES_DIR, name)
    const manifest = join(pkgDir, 'package.json')
    if (!existsSync(manifest)) continue

    let pkg
    try {
      pkg = JSON.parse(readFileSync(manifest, 'utf8'))
    } catch {
      continue
    }
    if (!pkg.publishConfig || pkg.private === true) continue

    const tsupPath = ['tsup.config.ts', 'tsup.config.mts', 'tsup.config.js', 'tsup.config.mjs']
      .map((f) => join(pkgDir, f))
      .find((f) => existsSync(f))
    const entries = tsupPath ? parseTsupEntries(readFileSync(tsupPath, 'utf8')) : new Map()
    const license = expectedIdentifier(pkg)
    const seen = new Set()

    for (const target of distTargets(pkg)) {
      const { source, built } = resolveSource(target, entries, (rel) => existsSync(join(pkgDir, rel)))
      if (!source) {
        failures.push(`packages/${name}: ${target} maps to no source file (checked the tsup entry and src/)`)
        continue
      }
      if (!built) {
        warnings.push(`packages/${name}: ${target} is published in package.json but no tsup entry builds ${source}`)
      }
      if (seen.has(source)) continue
      seen.add(source)
      checked++
      const rel = `packages/${name}/${source}`
      const text = readFileSync(join(pkgDir, source), 'utf8')
      const m = text.match(SPDX_RE)
      if (KNOWN_MISSING.has(rel)) {
        seenKnown.add(rel)
        if (m) failures.push(`${rel}: has its SPDX header now — remove it from KNOWN_MISSING in scripts/check-spdx-headers.mjs`)
        else known.push(rel)
      } else if (!m) {
        failures.push(`${rel}: MISSING SPDX header (entry for ${target})`)
      } else if (license && m[1] !== license) {
        failures.push(`${rel}: SPDX identifier ${m[1]} does not match package.json license ${license}`)
      }
    }
  }
  for (const rel of KNOWN_MISSING) {
    if (!seenKnown.has(rel)) failures.push(`${rel}: listed in KNOWN_MISSING but is no longer a published entry — remove it`)
  }

  for (const w of warnings) console.warn(`WARN ${w}`)
  for (const k of known) console.warn(`KNOWN MISSING ${k} (listed in KNOWN_MISSING; add the header, then delete the entry)`)

  if (failures.length === 0) {
    console.log(
      `check:spdx-headers — ${checked} published entry source file(s) checked; all others have matching SPDX identifiers ✓` +
        (known.length ? ` (${known.length} known missing, listed above)` : ''),
    )
    return 0
  }
  for (const f of failures) console.error(f)
  console.error(`\ncheck:spdx-headers — ${failures.length} problem(s) across ${checked} entry source file(s).`)
  console.error(
    'Add "// SPDX-License-Identifier: <package.json license>" as the first line (after any shebang or directive) of each file above.',
  )
  return 1
}

function isEntryScript() {
  if (!process.argv[1]) return false
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return import.meta.url === pathToFileURL(process.argv[1]).href
  }
}

if (isEntryScript()) process.exit(main())
