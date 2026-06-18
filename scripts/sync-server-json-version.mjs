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
  process.exit(0)
}

if (drift) {
  writeFileSync(SERVER_JSON, JSON.stringify(server, null, 2) + '\n')
  console.log(`✓  Synced server.json to ${version}.`)
} else {
  console.log(`✓  server.json already at ${version}.`)
}
