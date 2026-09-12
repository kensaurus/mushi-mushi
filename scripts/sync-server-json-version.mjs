#!/usr/bin/env node
/**
 * sync-server-json-version.mjs
 *
 * Keep packages/mcp/server.json (the official MCP registry manifest) in
 * lockstep with the just-published npm version. The registry requires the
 * manifest `version` (and the npm package entry's `version`) to match the
 * version actually on the npm registry, so we sync from package.json right
 * before `mcp-publisher publish` runs in release CI.
 *
 * It also validates the manifest against the registry's own hard constraints.
 * Version sync alone is not enough: on 2026-09-13 `description` had grown to
 * 1166 characters against a schema `maxLength` of 100, which `mcp-publisher`
 * rejects — a release-time failure with no local signal, because nothing
 * checked the manifest shape. See docs/marketing/GTM-DISTRIBUTION.md.
 *
 *   node scripts/sync-server-json-version.mjs           # write
 *   node scripts/sync-server-json-version.mjs --check    # verify only (exit 1 on drift)
 */

import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const PKG = path.join(ROOT, 'packages/mcp/package.json')
const SERVER_JSON = path.join(ROOT, 'packages/mcp/server.json')

const checkOnly = process.argv.includes('--check')

const pkg = JSON.parse(readFileSync(PKG, 'utf8'))
const server = JSON.parse(readFileSync(SERVER_JSON, 'utf8'))

/**
 * Constraints taken from the registry schema referenced by `$schema`
 * (https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json).
 * Kept as a small hand-written list rather than a full JSON-Schema validator so
 * this stays dependency-free and runnable in release CI before install.
 */
const DESCRIPTION_MAX = 100
const NAME_RE = /^[a-z0-9.-]+\/[a-z0-9._-]+$/

function validateRegistryConstraints(manifest) {
  const problems = []

  const desc = manifest.description
  if (typeof desc !== 'string' || desc.length === 0) {
    problems.push('description is required and must be a non-empty string')
  } else if (desc.length > DESCRIPTION_MAX) {
    problems.push(
      `description is ${desc.length} characters; the registry schema allows ${DESCRIPTION_MAX}. ` +
        'It is the primary search-indexed field — keep it one capability sentence. ' +
        'Cross-promotion and tables belong in the README, not here.',
    )
  }

  if (typeof manifest.name !== 'string' || !NAME_RE.test(manifest.name)) {
    problems.push(`name "${manifest.name}" must look like "io.github.owner/repo"`)
  }

  if (!Array.isArray(manifest.packages) && !Array.isArray(manifest.remotes)) {
    problems.push('at least one of `packages` or `remotes` must be present')
  }

  for (const url of [manifest.websiteUrl, manifest.repository?.url]) {
    if (url === undefined) continue
    try {
      new URL(url)
    } catch {
      problems.push(`"${url}" is not a valid absolute URL`)
    }
  }

  return problems
}

const problems = validateRegistryConstraints(server)
if (problems.length > 0) {
  console.error(`✗  packages/mcp/server.json violates the MCP registry schema:\n`)
  for (const p of problems) console.error(`   - ${p}`)
  console.error(`\n   mcp-publisher would reject this manifest at release time.`)
  process.exit(1)
}

const version = pkg.version
let drift = false

if (server.version !== version) {
  drift = true
  server.version = version
}
for (const entry of server.packages ?? []) {
  if (entry.identifier === pkg.name && entry.version !== version) {
    drift = true
    entry.version = version
  }
}

if (checkOnly) {
  if (drift) {
    console.error(
      `server.json is out of sync with package.json (${version}). Run: node scripts/sync-server-json-version.mjs`,
    )
    process.exit(1)
  }
  console.log(`✓  server.json version matches package.json (${version}).`)
  console.log(`✓  server.json satisfies the registry schema constraints.`)
  process.exit(0)
}

if (drift) {
  writeFileSync(SERVER_JSON, JSON.stringify(server, null, 2) + '\n')
  console.log(`✓  Synced server.json to ${version}.`)
} else {
  console.log(`✓  server.json already at ${version}.`)
}
