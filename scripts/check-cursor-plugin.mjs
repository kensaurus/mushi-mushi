#!/usr/bin/env node
/**
 * scripts/check-cursor-plugin.mjs
 *
 * Validates the Mushi Cursor Plugin bundle under packages/cursor-plugin/, and
 * every MCP client config committed anywhere in the repo. Runs in CI.
 *
 * Checks:
 *  1. plugin.json is valid JSON, uses only fields from Cursor's manifest
 *     reference, and its version matches @mushi-mushi/mcp
 *  2. mcp.json exists, is valid JSON, has a hosted HTTP and/or stdio entry, no
 *     placeholder host, and every ${VAR} it uses is declared in `variables`
 *  3. Skills referenced in plugin.json are directories holding a SKILL.md
 *  4. Rule files referenced in plugin.json exist
 *  5. Command files referenced in plugin.json exist
 *  6. README.md and the manifest's logo exist
 *  7. Repo-wide: every tracked *.json `mcpServers` entry with a `url` declares
 *     a remote `type`, and no shipped config points at a placeholder host.
 *     Claude Code skips a url entry with no type, so a plugin missing it
 *     installs cleanly and exposes no server; `claude plugin validate` passes it.
 *  8. Every packages/mcp/server.json icon served from this repo's
 *     raw.githubusercontent.com URL is git-tracked (an ignored file 404s)
 *
 *   node scripts/check-cursor-plugin.mjs           # verify (exit 1 on failure)
 *   node scripts/check-cursor-plugin.mjs --write   # also sync plugin.json version
 */

import { readFileSync, existsSync, statSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  collectMcpServerEntries,
  isTrackedFile,
  lintCursorManifest,
  lintMcpConfig,
  listTrackedJsonFiles,
  repoPathFromRawUrl,
} from './lib/mcp-configs.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '..')
const pluginRoot = resolve(repoRoot, 'packages', 'cursor-plugin')
const writeMode = process.argv.includes('--write')

let failures = 0

function fail(msg) {
  console.error(`  ✗ FAIL: ${msg}`)
  failures++
}

function warn(msg) {
  console.warn(`  ! ${msg}`)
}

function ok(msg) {
  console.log(`  ✓ ${msg}`)
}

function readJson(relPath) {
  const abs = resolve(pluginRoot, relPath)
  if (!existsSync(abs)) {
    fail(`${relPath} does not exist`)
    return null
  }
  try {
    return JSON.parse(readFileSync(abs, 'utf8'))
  } catch (e) {
    fail(`${relPath} is not valid JSON: ${e.message}`)
    return null
  }
}

function asList(value) {
  if (value === undefined) return []
  return Array.isArray(value) ? value : [value]
}

console.log('\n── Cursor plugin manifest validation ───────────────────────────────────────')

// 1. plugin.json
const manifestPath = '.cursor-plugin/plugin.json'
const manifest = readJson(manifestPath)
const mcpConfigPath = typeof manifest?.mcpServers === 'string' ? manifest.mcpServers : 'mcp.json'
const mcpConfig = readJson(mcpConfigPath)

if (manifest) {
  ok(`${manifestPath} — valid JSON`)
  for (const field of ['name', 'displayName', 'version', 'description', 'author', 'logo']) {
    if (!manifest[field]) fail(`plugin.json missing required field: ${field}`)
  }
  for (const problem of lintCursorManifest(manifest, mcpConfig)) fail(problem)

  // The bundle ships the MCP server, so it versions with it. A stale version
  // here is what a marketplace reviewer sees next to the npm badge.
  const { version: mcpVersion } = JSON.parse(
    readFileSync(resolve(repoRoot, 'packages', 'mcp', 'package.json'), 'utf8'),
  )
  if (manifest.version !== mcpVersion) {
    if (writeMode) {
      const abs = resolve(pluginRoot, manifestPath)
      const source = readFileSync(abs, 'utf8')
      writeFileSync(abs, source.replace(`"version": "${manifest.version}"`, `"version": "${mcpVersion}"`))
      ok(`plugin.json version ${manifest.version} → ${mcpVersion}`)
    } else {
      fail(
        `plugin.json version ${manifest.version} ≠ @mushi-mushi/mcp ${mcpVersion} — run node scripts/check-cursor-plugin.mjs --write`,
      )
    }
  } else {
    ok(`plugin.json fields: name="${manifest.name}", version="${manifest.version}" (matches @mushi-mushi/mcp)`)
  }
}

// 2. mcp.json
if (mcpConfig) {
  ok(`${mcpConfigPath} — valid JSON`)
  const entries = collectMcpServerEntries(mcpConfig)
  if (entries.length === 0) {
    fail(`${mcpConfigPath} defines no mcpServers`)
  } else {
    ok(`${mcpConfigPath} servers: ${entries.map((e) => e.name).join(', ')}`)
    const hasHttp = entries.some((e) => typeof e.entry?.url === 'string')
    const hasStdio = entries.some((e) => typeof e.entry?.command === 'string')
    if (!hasHttp && !hasStdio) fail(`${mcpConfigPath} must define at least one http or stdio server`)
    if (hasHttp) ok(`${mcpConfigPath} has hosted HTTP server entry`)
    if (hasStdio) ok(`${mcpConfigPath} has stdio fallback server entry`)
  }
  // Cursor reads mcp.json; a second, drifting copy is how the placeholder URL
  // survived in two places at once.
  if (existsSync(resolve(pluginRoot, '.mcp.json')) && mcpConfigPath !== '.mcp.json') {
    fail(`packages/cursor-plugin/.mcp.json duplicates ${mcpConfigPath} — Cursor reads ${mcpConfigPath}; delete the copy`)
  }
}

// 3. Skills — Cursor resolves each entry as a skill directory.
for (const skill of asList(manifest?.skills)) {
  const abs = resolve(pluginRoot, skill)
  if (!existsSync(abs) || !statSync(abs).isDirectory()) {
    fail(`Skill path must be a directory: ${skill}`)
  } else if (!existsSync(resolve(abs, 'SKILL.md'))) {
    fail(`Skill directory has no SKILL.md: ${skill}`)
  } else {
    ok(`Skill exists: ${skill}`)
  }
}

// 4. Rules
for (const rule of asList(manifest?.rules)) {
  if (!existsSync(resolve(pluginRoot, rule))) {
    fail(`Rule file not found: ${rule}`)
  } else {
    ok(`Rule exists: ${rule}`)
  }
}

// 5. Commands
for (const cmd of asList(manifest?.commands)) {
  if (!existsSync(resolve(pluginRoot, cmd))) {
    fail(`Command file not found: ${cmd}`)
  } else {
    ok(`Command exists: ${cmd}`)
  }
}

// 6. README and logo
if (!existsSync(resolve(pluginRoot, 'README.md'))) {
  fail('README.md does not exist in packages/cursor-plugin/')
} else {
  ok('README.md exists')
}
if (typeof manifest?.logo === 'string' && !/^https?:\/\//.test(manifest.logo)) {
  if (!existsSync(resolve(pluginRoot, manifest.logo))) {
    fail(`logo "${manifest.logo}" does not exist in packages/cursor-plugin/`)
  } else {
    ok(`Logo exists: ${manifest.logo}`)
  }
}

// 7. Every committed MCP client config in the repo
console.log('\n── Committed MCP client configs ────────────────────────────────────────────')
let tracked = []
try {
  tracked = listTrackedJsonFiles(repoRoot)
} catch (e) {
  fail(`could not list tracked files with git: ${e.message}`)
}
let configCount = 0
for (const rel of tracked) {
  const source = readFileSync(resolve(repoRoot, rel), 'utf8')
  if (!source.includes('"mcpServers"')) continue
  let doc
  try {
    doc = JSON.parse(source)
  } catch (e) {
    fail(`${rel} is not valid JSON: ${e.message}`)
    continue
  }
  configCount++
  const problems = lintMcpConfig(doc, { allowPlaceholderHosts: rel.endsWith('.example') })
  for (const problem of problems) fail(`${rel}: ${problem}`)
  if (problems.length === 0) ok(`${rel}`)
}
if (configCount === 0 && tracked.length > 0) warn('no tracked JSON file declares mcpServers')

// 8. Listing icons. packages/mcp/server.json (the MCP registry entry) and the
// Cursor Marketplace form both use a raw.githubusercontent.com URL on master,
// so the file must be committed; `*.png` is git-ignored repo-wide.
console.log('\n── Listing icons ───────────────────────────────────────────────────────────')
const serverJson = JSON.parse(readFileSync(resolve(repoRoot, 'packages', 'mcp', 'server.json'), 'utf8'))
for (const icon of serverJson.icons ?? []) {
  const local = typeof icon?.src === 'string' ? repoPathFromRawUrl(icon.src) : null
  if (!local) continue
  if (!existsSync(resolve(repoRoot, local.path))) {
    fail(`server.json icon ${local.path} does not exist in the repo — ${icon.src} will 404`)
  } else if (!isTrackedFile(repoRoot, local.path)) {
    fail(`server.json icon ${local.path} is not tracked by git (check .gitignore) — ${icon.src} will 404`)
  } else {
    ok(`server.json icon ${local.path} is tracked`)
  }
}

console.log('\n── Summary ─────────────────────────────────────────────────────────────────')
if (failures === 0) {
  console.log('   Cursor plugin bundle and committed MCP configs are valid.\n')
  process.exit(0)
} else {
  console.log(`   ${failures} failure(s) — fix them before publishing the plugin.\n`)
  process.exit(1)
}
