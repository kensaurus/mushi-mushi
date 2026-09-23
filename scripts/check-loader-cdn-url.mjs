#!/usr/bin/env node
/**
 * FILE: scripts/check-loader-cdn-url.mjs
 * PURPOSE: Keep the no-build `<script>` install path pointing at a file that
 *          exists, before and after a release.
 *
 * The "Script tag" install is a jsDelivr URL into the published
 * @mushi-mushi/web tarball. It is written down in four places that nothing tied
 * together: the tsup IIFE entry that names the file, the `jsdelivr` / `unpkg`
 * fields in packages/web/package.json, the example in packages/web/src/loader.ts,
 * and LOADER_CDN_URL in apps/admin/src/lib/sdkSnippets.ts (what the console
 * tells people to paste). The tag once pointed at a host that never resolved,
 * so a pasted tag loaded nothing and showed no error.
 *
 * Offline (CI, every PR):
 *   node scripts/check-loader-cdn-url.mjs
 *   - tsup builds an IIFE entry whose output (`<entry>.global.js`) is the file
 *     `jsdelivr` and `unpkg` both point at, and `files` ships `dist`
 *   - loader.ts and sdkSnippets.ts both use
 *     https://cdn.jsdelivr.net/npm/@mushi-mushi/web@<major>/<that file>,
 *     <major> being the current major of @mushi-mushi/web
 *   - every other jsDelivr / unpkg URL for @mushi-mushi/web in docs, READMEs,
 *     skills and the console names the same file and major
 *
 * Online (release.yml, after a publish):
 *   PUBLISHED='[{"name":"@mushi-mushi/web","version":"1.28.1"}]' \
 *     node scripts/check-loader-cdn-url.mjs --online
 *   Fetches the VERSIONED jsDelivr URL for the version just published, with
 *   retries while jsDelivr picks the version up from npm, and fails unless it
 *   answers 200 with that version's loader (the bundle inlines the SDK version
 *   string and reads `data-project` off its script tag). Exits 0 without
 *   fetching when @mushi-mushi/web is not in PUBLISHED.
 */

import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { parseTsupEntries } from './check-spdx-headers.mjs'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const WEB = join(ROOT, 'packages/web')
const PKG_NAME = '@mushi-mushi/web'
const CDN_PREFIX = `https://cdn.jsdelivr.net/npm/${PKG_NAME}@`

// Every jsDelivr or unpkg URL that names the web package, with or without a
// version and a file path. Stops at characters that end a URL in prose/code.
const CDN_URL_RE = /https:\/\/(?:cdn\.jsdelivr\.net\/npm|unpkg\.com)\/@mushi-mushi\/web(?:@[^/\s'"`)<>]*)?(?:\/[^\s'"`)<>]*)?/g

const SCAN_DIRS = ['apps/docs/content', 'apps/admin/src', 'packages/web/src', 'skills', 'docs']
const SCAN_EXT = /\.(md|mdx|ts|tsx|js|mjs|txt)$/
const SKIP_DIRS = new Set(['node_modules', 'dist', '.next', '.turbo', 'out'])

/** `./dist/mushi.loader.global.js` → `dist/mushi.loader.global.js` */
export function normalizeField(value) {
  return typeof value === 'string' ? value.replace(/^\.\//, '') : null
}

export function canonicalUrl(major, file) {
  return `${CDN_PREFIX}${major}/${file}`
}

/**
 * Pure agreement check. Returns a list of human-readable problems.
 * @param {object} input
 * @param {{ version: string, jsdelivr?: string, unpkg?: string, files?: string[] }} input.pkg
 * @param {string} input.tsupConfig packages/web/tsup.config.ts source
 * @param {string} input.loaderSource packages/web/src/loader.ts source
 * @param {string} input.snippetsSource apps/admin/src/lib/sdkSnippets.ts source
 * @param {{ file: string, url: string }[]} [input.otherUrls] CDN URLs found elsewhere
 */
export function checkAgreement({ pkg, tsupConfig, loaderSource, snippetsSource, otherUrls = [] }) {
  const problems = []
  const major = String(pkg.version).split('.')[0]
  const jsdelivr = normalizeField(pkg.jsdelivr)
  const unpkg = normalizeField(pkg.unpkg)

  if (!jsdelivr) problems.push('packages/web/package.json has no `jsdelivr` field')
  if (!unpkg) problems.push('packages/web/package.json has no `unpkg` field')
  if (jsdelivr && unpkg && jsdelivr !== unpkg) {
    problems.push(`packages/web/package.json: jsdelivr (${pkg.jsdelivr}) and unpkg (${pkg.unpkg}) disagree`)
  }
  const file = jsdelivr ?? unpkg
  if (!file) return problems

  if (!(pkg.files ?? []).some((f) => file === f || file.startsWith(`${f.replace(/\/$/, '')}/`))) {
    problems.push(`packages/web/package.json: "files" does not publish ${file}`)
  }

  const m = file.match(/^dist\/(.+)\.global\.js$/)
  if (!m) {
    problems.push(`${file} is not a tsup IIFE output (dist/<entry>.global.js)`)
  } else {
    const entries = parseTsupEntries(tsupConfig)
    if (!entries.has(m[1])) {
      problems.push(`packages/web/tsup.config.ts has no entry named '${m[1]}', so ${file} is never built`)
    }
    if (!/format:\s*\[\s*['"]iife['"]\s*\]/.test(tsupConfig)) {
      problems.push("packages/web/tsup.config.ts has no format: ['iife'] build, so no .global.js is emitted")
    }
  }

  const expected = canonicalUrl(major, file)
  const snippet = snippetsSource.match(/LOADER_CDN_URL\s*=\s*['"`]([^'"`]+)['"`]/)
  if (!snippet) problems.push('apps/admin/src/lib/sdkSnippets.ts: LOADER_CDN_URL not found')
  else if (snippet[1] !== expected) {
    problems.push(`apps/admin/src/lib/sdkSnippets.ts: LOADER_CDN_URL is ${snippet[1]}, expected ${expected}`)
  }

  const loaderUrls = [...loaderSource.matchAll(CDN_URL_RE)].map((x) => x[0])
  if (loaderUrls.length === 0) problems.push('packages/web/src/loader.ts: no example jsDelivr URL in the header comment')
  for (const url of loaderUrls) {
    if (url !== expected) problems.push(`packages/web/src/loader.ts: example URL ${url}, expected ${expected}`)
  }

  for (const { file: where, url } of otherUrls) {
    const parsed = url.match(/@mushi-mushi\/web(?:@([^/]*))?(?:\/(.*))?$/)
    const ver = parsed?.[1]
    const path = parsed?.[2]
    if (ver !== undefined && ver !== major && !ver.startsWith(`${major}.`)) {
      problems.push(`${where}: ${url} pins @${ver}, but @mushi-mushi/web is on major ${major}`)
    }
    if (path && path !== file) problems.push(`${where}: ${url} names ${path}, but the loader ships as ${file}`)
  }
  return problems
}

function walk(dir, out) {
  if (!existsSync(dir)) return out
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue
    const abs = join(dir, name)
    if (statSync(abs).isDirectory()) walk(abs, out)
    else if (SCAN_EXT.test(name)) out.push(abs)
  }
  return out
}

function collectOtherUrls() {
  const files = SCAN_DIRS.flatMap((d) => walk(join(ROOT, d), []))
  files.push(join(ROOT, 'README.md'))
  for (const dir of readdirSync(join(ROOT, 'packages'))) {
    const readme = join(ROOT, 'packages', dir, 'README.md')
    if (existsSync(readme)) files.push(readme)
  }
  const skip = new Set([join(WEB, 'src/loader.ts'), join(ROOT, 'apps/admin/src/lib/sdkSnippets.ts')])
  const out = []
  for (const abs of files) {
    if (skip.has(abs) || /\.test\.[cm]?[jt]sx?$/.test(abs)) continue
    const text = readFileSync(abs, 'utf8')
    for (const m of text.matchAll(CDN_URL_RE)) {
      out.push({ file: relative(ROOT, abs).replace(/\\/g, '/'), url: m[0].replace(/[.,;:]+$/, '') })
    }
  }
  return out
}

function offline() {
  const pkg = JSON.parse(readFileSync(join(WEB, 'package.json'), 'utf8'))
  const problems = checkAgreement({
    pkg,
    tsupConfig: readFileSync(join(WEB, 'tsup.config.ts'), 'utf8'),
    loaderSource: readFileSync(join(WEB, 'src/loader.ts'), 'utf8'),
    snippetsSource: readFileSync(join(ROOT, 'apps/admin/src/lib/sdkSnippets.ts'), 'utf8'),
    otherUrls: collectOtherUrls(),
  })
  if (problems.length > 0) {
    console.error('check-loader-cdn-url: the script-tag loader URL has drifted:\n')
    for (const p of problems) console.error(`  • ${p}`)
    return 1
  }
  const file = normalizeField(pkg.jsdelivr)
  console.log(`check-loader-cdn-url: ${canonicalUrl(String(pkg.version).split('.')[0], file)} agrees everywhere ✓`)
  return 0
}

/** Version of @mushi-mushi/web in changesets' publishedPackages JSON, or null. */
export function publishedWebVersion(publishedJson) {
  let list
  try {
    list = JSON.parse(publishedJson || '[]')
  } catch {
    throw new Error('PUBLISHED is not valid JSON')
  }
  if (!Array.isArray(list)) throw new Error('PUBLISHED must be a JSON array')
  return list.find((p) => p?.name === PKG_NAME)?.version ?? null
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function online() {
  const version = publishedWebVersion(process.env.PUBLISHED)
  if (!version) {
    console.log(`check-loader-cdn-url --online: ${PKG_NAME} was not published in this run; nothing to fetch.`)
    return 0
  }
  const pkg = JSON.parse(readFileSync(join(WEB, 'package.json'), 'utf8'))
  const file = normalizeField(pkg.jsdelivr)
  const url = `${CDN_PREFIX}${version}/${file}`
  // jsDelivr resolves a new version from npm on first request; right after a
  // publish that can 404 for a few minutes. 1+2+4+…+64s ≈ 4 minutes.
  const attempts = Number(process.env.LOADER_CDN_ATTEMPTS ?? 8)
  let delay = 1000
  let last = ''
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30_000), headers: { 'cache-control': 'no-cache' } })
      const body = res.status === 200 ? await res.text() : ''
      const missing = [JSON.stringify(version), 'data-project'].filter((marker) => !body.includes(marker))
      if (res.status === 200 && missing.length === 0) {
        console.log(`✓ ${url} → 200 (${body.length} bytes, the ${version} loader)`)
        return 0
      }
      last = res.status === 200 ? `200 but the body lacks ${missing.join(' and ')}` : `HTTP ${res.status}`
    } catch (err) {
      last = err instanceof Error ? err.message : String(err)
    }
    if (i < attempts) {
      console.log(`… ${url}: ${last} (attempt ${i}/${attempts}); retrying in ${delay / 1000}s`)
      await sleep(delay)
      delay *= 2
    }
  }
  console.error(`::error::${url} did not serve the loader after ${attempts} attempts (last: ${last}).`)
  console.error('Every pasted <script> tag for this version loads nothing. Check the tarball contents and the jsdelivr field.')
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

if (isEntryScript()) {
  const code = process.argv.includes('--online') ? await online() : offline()
  process.exitCode = code
}
