#!/usr/bin/env node
/**
 * FILE: scripts/sync-mcp-tool-count.mjs
 * PURPOSE: Derives TOOL_COUNT, RESOURCE_COUNT, and PROMPT_COUNT from the
 *          canonical catalog (packages/mcp/src/catalog.ts) and writes the
 *          constants to the server admin route (mcp-admin.ts) that uses them
 *          for the /test-connection health check.
 *
 *          Run locally:  node scripts/sync-mcp-tool-count.mjs
 *          --check mode: exits 1 if the file is out of sync (used in CI)
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

const CHECK_MODE = process.argv.includes('--check')

function countCatalogEntries(catalogSource) {
  const lines = catalogSource.split('\n')
  const counts = { tool: 0, resource: 0, prompt: 0 }
  let section = null

  for (const line of lines) {
    if (/export const TOOL_CATALOG\b/.test(line) ||
        /export const TDD_TOOL_CATALOG\b/.test(line) ||
        /export const CODEBASE_TOOL_CATALOG\b/.test(line)) {
      section = 'tool'
    } else if (/export const RESOURCE_CATALOG\b/.test(line)) {
      section = 'resource'
    } else if (/export const PROMPT_CATALOG\b/.test(line)) {
      section = 'prompt'
    }
    // Each tool/resource/prompt starts with "    name: 'xxx'" at 4-space indent
    if (section && /^\s{4}name:\s+'/.test(line)) {
      counts[section]++
    }
  }
  return counts
}

const catalogPath = resolve(ROOT, 'packages/mcp/src/catalog.ts')
const adminPath = resolve(ROOT, 'packages/server/supabase/functions/api/routes/mcp-admin.ts')

const catalogSource = readFileSync(catalogPath, 'utf8')
const { tool, resource, prompt } = countCatalogEntries(catalogSource)

let adminSource = readFileSync(adminPath, 'utf8')

const expected = [
  `const TOOL_COUNT = ${tool}`,
  `const RESOURCE_COUNT = ${resource}`,
  `const PROMPT_COUNT = ${prompt}`,
]
const patterns = [
  /const TOOL_COUNT = \d+/,
  /const RESOURCE_COUNT = \d+/,
  /const PROMPT_COUNT = \d+/,
]

let outOfSync = false
for (let i = 0; i < patterns.length; i++) {
  const match = adminSource.match(patterns[i])
  if (!match || match[0] !== expected[i]) {
    outOfSync = true
    if (!CHECK_MODE) {
      adminSource = adminSource.replace(patterns[i], expected[i])
    }
  }
}

if (CHECK_MODE) {
  if (outOfSync) {
    console.error(`\n✗ mcp-admin.ts TOOL_COUNT constants are out of sync with catalog.ts.`)
    console.error(`  Expected: TOOL=${tool}, RESOURCE=${resource}, PROMPT=${prompt}`)
    console.error(`  Run: node scripts/sync-mcp-tool-count.mjs\n`)
    process.exit(1)
  }
  console.log(`✓ mcp-admin.ts counts in sync: TOOL=${tool}, RESOURCE=${resource}, PROMPT=${prompt}`)
  process.exit(0)
}

writeFileSync(adminPath, adminSource, 'utf8')
console.log(`✓ Updated mcp-admin.ts: TOOL_COUNT=${tool} RESOURCE_COUNT=${resource} PROMPT_COUNT=${prompt}`)
