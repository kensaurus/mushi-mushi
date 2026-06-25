#!/usr/bin/env node
/**
 * Fail CI when user-facing files reference unverified *.mushimushi.dev hosts.
 * SSOT: packages/brand MUSHI_CANONICAL_URLS + docs/marketing/canonical-urls.md
 *
 *   node scripts/check-canonical-urls.mjs
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const BANNED = [
  'api.mushimushi.dev',
  'docs.mushimushi.dev',
  'app.mushimushi.dev',
  'admin.mushimushi.dev',
  'console.mushimushi.dev',
  'us.api.mushimushi.dev',
  'eu.api.mushimushi.dev',
  'jp.api.mushimushi.dev',
  'api.us.mushimushi.dev',
  'api.eu.mushimushi.dev',
  'api.jp.mushimushi.dev',
]

/** Bare product host — allow Bluesky profile + trademark / future-DNS notes. */
const BANNED_BARE_HOST = /https:\/\/mushimushi\.dev(?![/\w])/g

const SCAN_ROOTS = ['apps', 'packages', 'scripts', 'docs/marketing', '.mcp.json', 'glama.json', 'packages/mcp/server.json']

const SKIP_PARTS = [
  'CHANGELOG.md',
  'docs/audit-',
  'docs/runbooks/region-routing-replication.md',
  'TRADEMARK.md',
  'STOREFRONTS.md',
  'plan-antislop.md',
  'canonical-urls.md',
  'check-canonical-urls.mjs',
  'bulk-fix-urls.mjs',
  'node_modules',
  '.git',
  '.turbo',
  'dist',
  'out',
  '.next',
  'session-artifacts',
]

const ALLOW_LINE = [
  /bsky\.app\/profile\/mushimushi\.dev/,
  /\*@mushimushi\.dev/,
  /test@mushimushi\.dev/,
  /BLUESKY_HANDLE=mushimushi\.dev/,
  /mushimushi\.dev`/,
  /`mushimushi\.dev`/,
  /reserve `mushimushi\.dev`/,
  /api\.test\.mushimushi\.dev/,
  /Regional hostnames \(`api\.us\.mushimushi\.dev`/,
  /503 — use/,
  /Not the deployed product home/,
  /Not verified — use/,
  /Aliases — do not use/,
  /api\.mushimushi\.io/,
]

const EXT = new Set([
  '.md',
  '.mdx',
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.json',
  '.yaml',
  '.yml',
  '.swift',
  '.podspec',
  '.html',
  '.txt',
  '.mjs',
  '.cjs',
])

function shouldSkip(rel) {
  return SKIP_PARTS.some((p) => rel.includes(p))
}

function walk(target, acc = []) {
  let st
  try {
    st = statSync(target)
  } catch {
    return acc
  }
  if (st.isFile()) {
    acc.push(target)
    return acc
  }
  for (const name of readdirSync(target)) {
    if (name.startsWith('.')) continue
    const full = join(target, name)
    const rel = full.slice(ROOT.length + 1).replace(/\\/g, '/')
    if (shouldSkip(rel)) continue
    try {
      walk(full, acc)
    } catch {
      /* race on temp files */
    }
  }
  return acc
}

const files = []
for (const entry of SCAN_ROOTS) {
  const target = join(ROOT, entry)
  walk(target, files)
}

const failures = []

for (const file of files) {
  const rel = file.slice(ROOT.length + 1).replace(/\\/g, '/')
  const base = rel.split('/').pop() ?? rel
  if (!EXT.has(base.slice(base.lastIndexOf('.'))) && !['.mcp.json', 'glama.json', 'server.json'].includes(base)) {
    continue
  }
  const lines = readFileSync(file, 'utf8').split(/\r?\n/)
  lines.forEach((line, idx) => {
    if (ALLOW_LINE.some((re) => re.test(line))) return
    for (const banned of BANNED) {
      if (line.includes(banned)) {
        failures.push(`${rel}:${idx + 1}: banned host ${banned}`)
      }
    }
    if (BANNED_BARE_HOST.test(line)) {
      failures.push(`${rel}:${idx + 1}: banned bare host https://mushimushi.dev`)
    }
    BANNED_BARE_HOST.lastIndex = 0
  })
}

if (failures.length) {
  console.error('check-canonical-urls: FAIL\n')
  for (const f of failures) console.error(`  ${f}`)
  console.error('\nUse MUSHI_CANONICAL_URLS from @mushi-mushi/brand — see docs/marketing/canonical-urls.md')
  process.exit(1)
}

console.log(`check-canonical-urls: OK (${files.length} files scanned)`)
