#!/usr/bin/env node
/**
 * scripts/check-mcp-publish-readiness.mjs
 *
 * Pre-publish gate for @mushi-mushi/mcp. Verifies:
 *  1. packages/mcp/package.json has correct metadata (name, version, description,
 *     homepage, bugs, repository, license, author, engines)
 *  2. packages/mcp/README.md exists and is non-empty
 *  3. dist/index.js exists (built)
 *  4. dist/catalog.js and dist/server.js exist (sub-path exports built)
 *  5. bin entry points to dist/index.js
 *  6. catalog drift guard passes (re-runs check-mcp-catalog-sync.mjs)
 *  7. Cursor plugin manifest is valid (re-runs check-cursor-plugin.mjs)
 *  8. Marketplace doc exists (docs/marketplace/cursor-mushi-plugin.md)
 */

import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')
const mcpPkg = resolve(root, 'packages', 'mcp')

let failures = 0
let warnings = 0

function fail(msg) {
  console.error(`  ✗ FAIL:  ${msg}`)
  failures++
}

function warn(msg) {
  console.warn(`  ⚠ WARN:  ${msg}`)
  warnings++
}

function ok(msg) {
  console.log(`  ✓ ${msg}`)
}

console.log('\n── MCP publish readiness ───────────────────────────────────────────────────')

// 1. package.json metadata
const pkgJsonPath = resolve(mcpPkg, 'package.json')
let pkg
try {
  pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8'))
  ok('packages/mcp/package.json — valid JSON')
} catch (e) {
  fail(`packages/mcp/package.json invalid: ${e.message}`)
  process.exit(1)
}

const requiredPkgFields = ['name', 'version', 'description', 'license', 'author', 'homepage', 'repository', 'bugs']
for (const field of requiredPkgFields) {
  if (!pkg[field]) {
    fail(`package.json missing field: ${field}`)
  }
}
if (pkg.name === '@mushi-mushi/mcp') ok(`package name: ${pkg.name}`)
if (pkg.version) ok(`version: ${pkg.version}`)
if (!pkg.engines?.node) warn('package.json missing engines.node — add "node": ">=18" for clarity')

// 2. README
const readmePath = resolve(mcpPkg, 'README.md')
if (!existsSync(readmePath)) {
  fail('packages/mcp/README.md does not exist')
} else {
  const readme = readFileSync(readmePath, 'utf8')
  if (readme.length < 200) {
    warn('packages/mcp/README.md is very short — expand before publishing')
  } else {
    ok('packages/mcp/README.md exists and is non-empty')
  }
}

// 3-4. dist files and declaration files referenced by package exports.
for (const distFile of [
  'dist/index.js',
  'dist/index.d.ts',
  'dist/catalog.js',
  'dist/catalog.d.ts',
  'dist/server.js',
  'dist/server.d.ts',
]) {
  const abs = resolve(mcpPkg, distFile)
  if (!existsSync(abs)) {
    fail(`${distFile} not found — run pnpm --filter @mushi-mushi/mcp build first`)
  } else {
    ok(`${distFile} exists`)
  }
}

// 5. bin entry
const binEntry = pkg.bin?.['mushi-mcp'] ?? pkg.bin
if (typeof binEntry === 'string') {
  if (binEntry.includes('dist/index.js')) {
    ok(`bin entry points to dist/index.js`)
  } else {
    warn(`bin entry "${binEntry}" does not point to dist/index.js`)
  }
} else if (typeof binEntry === 'object' && binEntry !== null) {
  const entries = Object.values(binEntry)
  if (entries.some(e => e.includes('dist/index.js'))) {
    ok(`bin entry points to dist/index.js`)
  } else {
    warn(`bin entries do not point to dist/index.js: ${JSON.stringify(entries)}`)
  }
} else {
  warn('package.json missing bin entry — CLI will not work via npx')
}

// 6. Catalog drift guard
console.log('\n── Catalog drift check ─────────────────────────────────────────────────────')
const catalogResult = spawnSync(process.execPath, [resolve(__dirname, 'check-mcp-catalog-sync.mjs')], {
  stdio: 'inherit',
})
if (catalogResult.status !== 0) {
  fail('Catalog sync check failed — see above output')
} else {
  ok('Catalog sync check passed')
}

// 7. Cursor plugin
console.log('\n── Cursor plugin check ─────────────────────────────────────────────────────')
const pluginResult = spawnSync(process.execPath, [resolve(__dirname, 'check-cursor-plugin.mjs')], {
  stdio: 'inherit',
})
if (pluginResult.status !== 0) {
  fail('Cursor plugin validation failed — see above output')
} else {
  ok('Cursor plugin is valid')
}

// 8. Marketplace docs
console.log('\n── Marketplace docs ────────────────────────────────────────────────────────')
const marketplaceDocs = [
  'docs/marketplace/cursor-mushi-plugin.md',
  'docs/marketplace/cursor-submission-checklist.md',
]
for (const doc of marketplaceDocs) {
  const abs = resolve(root, doc)
  if (!existsSync(abs)) {
    warn(`${doc} not found — create before marketplace submission`)
  } else {
    ok(`${doc} exists`)
  }
}

// ── Summary ──────────────────────────────────────────────────────────────────
console.log('\n── Summary ─────────────────────────────────────────────────────────────────')
if (failures === 0 && warnings === 0) {
  console.log('   @mushi-mushi/mcp is publish-ready.\n')
  process.exit(0)
} else {
  if (failures > 0) console.log(`   ${failures} hard failure(s) — must fix before publishing.`)
  if (warnings > 0) console.log(`   ${warnings} warning(s) — recommended to fix before marketplace submission.`)
  console.log()
  process.exit(failures > 0 ? 1 : 0)
}
