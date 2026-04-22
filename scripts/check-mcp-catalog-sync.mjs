#!/usr/bin/env node
/**
 * FILE: scripts/check-mcp-catalog-sync.mjs
 * PURPOSE: Lint guard — the MCP catalog lives in two places because tsup's
 *          shebang banner makes re-exporting from `@mushi-mushi/mcp` awkward.
 *          This script parses both files as text, extracts the TOOL_CATALOG /
 *          RESOURCE_CATALOG / PROMPT_CATALOG arrays, and diffs their
 *          normalised JSON. Fails the build loudly if they drift.
 *
 *          Run locally:   node scripts/check-mcp-catalog-sync.mjs
 *          In CI:          pnpm test:catalog-sync
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

const SERVER_PATH = resolve(ROOT, 'packages/mcp/src/catalog.ts')
const ADMIN_PATH = resolve(ROOT, 'apps/admin/src/lib/mcpCatalog.ts')

/**
 * Pull out the three catalog arrays as raw text and strip comments/
 * whitespace so trivial formatting diffs don't trip us. We only care that
 * the structural contents are identical.
 */
function extract(path) {
  const src = readFileSync(path, 'utf8')
  const arrays = {}
  for (const name of ['TOOL_CATALOG', 'RESOURCE_CATALOG', 'PROMPT_CATALOG']) {
    const re = new RegExp(`export const ${name}[^=]*=\\s*(\\[[\\s\\S]*?\\n\\])`, 'm')
    const match = src.match(re)
    if (!match) throw new Error(`${name} not found in ${path}`)
    arrays[name] = match[1]
      .replace(/\/\/.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\s+/g, ' ')
      .trim()
  }
  return arrays
}

const server = extract(SERVER_PATH)
const admin = extract(ADMIN_PATH)

let drift = false
for (const name of ['TOOL_CATALOG', 'RESOURCE_CATALOG', 'PROMPT_CATALOG']) {
  if (server[name] !== admin[name]) {
    drift = true
    console.error(`\n[drift] ${name} differs between MCP package and admin mirror.`)
    console.error(`  packages/mcp/src/catalog.ts  length: ${server[name].length}`)
    console.error(`  apps/admin/src/lib/mcpCatalog.ts length: ${admin[name].length}`)
  }
}

if (drift) {
  console.error('\nFix: mirror the change in both files, or run your edits from a single source and copy.')
  process.exit(1)
}

console.log('[ok] MCP catalog is in sync across packages/mcp and apps/admin.')
