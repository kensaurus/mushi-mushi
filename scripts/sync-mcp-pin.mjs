#!/usr/bin/env node
/**
 * FILE: scripts/sync-mcp-pin.mjs
 * PURPOSE: Keeps every surface that writes `@mushi-mushi/mcp@<version>` into a
 *          persistent MCP config pinned to the canonical version in
 *          packages/mcp/package.json. Pinning (instead of `@latest`) avoids
 *          supply-chain drift and npx cold-start cost on every editor launch.
 *
 *          Run locally:  node scripts/sync-mcp-pin.mjs
 *          --check mode: exits 1 if any file is out of sync (used in CI)
 *
 *          Runs automatically in `pnpm version-packages` so the pin follows
 *          each changeset release of @mushi-mushi/mcp.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

const CHECK_MODE = process.argv.includes('--check')

const { version } = JSON.parse(
  readFileSync(resolve(ROOT, 'packages/mcp/package.json'), 'utf8'),
)
const PIN = `@mushi-mushi/mcp@${version}`

// Files holding a pinned literal. Each must contain the spec at least once and
// must never contain `@mushi-mushi/mcp@latest`.
const PINNED_FILES = [
  'packages/mcp/src/clients.ts',
  'packages/cli/src/version.ts',
  'packages/vscode-extension/src/extension.ts',
  'apps/docs/public/integrations/claude-hooks.json',
  'apps/docs/content/quickstart/mcp.mdx',
]

const SPEC_RE = /@mushi-mushi\/mcp@(?:latest|\d+\.\d+\.\d+(?:-[\w.]+)?)/g

let outOfSync = []
for (const rel of PINNED_FILES) {
  const path = resolve(ROOT, rel)
  const source = readFileSync(path, 'utf8')
  const matches = source.match(SPEC_RE) ?? []
  if (matches.length === 0) {
    console.error(`✗ ${rel}: expected at least one @mushi-mushi/mcp@<version> literal, found none`)
    process.exitCode = 1
    continue
  }
  if (matches.every((m) => m === PIN)) continue
  outOfSync.push(rel)
  if (!CHECK_MODE) {
    writeFileSync(path, source.replace(SPEC_RE, PIN), 'utf8')
    console.log(`✓ Updated ${rel} → ${PIN}`)
  }
}

if (CHECK_MODE) {
  if (outOfSync.length > 0) {
    console.error(`\n✗ MCP pin out of sync with packages/mcp/package.json (${PIN}):`)
    for (const rel of outOfSync) console.error(`  - ${rel}`)
    console.error(`  Run: node scripts/sync-mcp-pin.mjs\n`)
    process.exit(1)
  }
  if (process.exitCode !== 1) {
    console.log(`✓ MCP pin in sync: ${PIN}`)
  }
} else if (outOfSync.length === 0) {
  console.log(`✓ MCP pin already in sync: ${PIN}`)
}
