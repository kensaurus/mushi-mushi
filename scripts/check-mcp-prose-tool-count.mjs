#!/usr/bin/env node
/**
 * FILE: scripts/check-mcp-prose-tool-count.mjs
 * PURPOSE: Fail CI when hand-written docs claim the wrong MCP tool count.
 *          Catalog count is derived the same way as sync-mcp-tool-count.mjs.
 *
 *   node scripts/check-mcp-prose-tool-count.mjs
 */

import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

function countCatalogEntries(catalogSource) {
  const lines = catalogSource.split('\n')
  let section = null
  let tool = 0
  for (const line of lines) {
    if (
      /export const TOOL_CATALOG\b/.test(line) ||
      /export const TDD_TOOL_CATALOG\b/.test(line) ||
      /export const CODEBASE_TOOL_CATALOG\b/.test(line)
    ) {
      section = 'tool'
    } else if (/export const RESOURCE_CATALOG\b/.test(line) || /export const PROMPT_CATALOG\b/.test(line)) {
      section = null
    }
    if (section === 'tool' && /^\s{4}name:\s+'/.test(line)) tool++
  }
  return tool
}

const catalogPath = resolve(ROOT, 'packages/mcp/src/catalog.ts')
const expected = countCatalogEntries(readFileSync(catalogPath, 'utf8'))

/** Files that must mention the live tool count when they mention "N tools". */
const PROSE_FILES = [
  'AGENTS.md',
  'apps/docs/content/sdks/mcp.mdx',
  'apps/docs/content/admin/mcp.mdx',
  'apps/docs/content/concepts/orchestrator-interop.mdx',
  'packages/mcp/README.md',
  'apps/docs/data/admin-screenshots.ts',
  'docs/SCREENSHOTS.md',
]

const claimRe = /(\d+)\s*-?\s*tools?\b/gi
const failures = []

for (const rel of PROSE_FILES) {
  const abs = resolve(ROOT, rel)
  if (!existsSync(abs)) continue
  const source = readFileSync(abs, 'utf8')
  claimRe.lastIndex = 0
  let match
  while ((match = claimRe.exec(source)) !== null) {
    const n = Number(match[1])
    if (!Number.isFinite(n)) continue
    // Ignore tiny incidental numbers (e.g. "3 tools in this example") but
    // catch undercounts like the old "~20 tools" catalog claim.
    if (n < 10) continue
    if (n !== expected) {
      const line = source.slice(0, match.index).split(/\r?\n/).length
      failures.push(`${rel}:${line} claims ${n} tools — catalog has ${expected}`)
    }
  }
}

if (failures.length > 0) {
  console.error(`\n✗ MCP prose tool-count drift (${failures.length}):\n`)
  for (const f of failures) console.error(`  ${f}`)
  console.error(`\n  Expected: ${expected} (from packages/mcp/src/catalog.ts)`)
  console.error('  Fix the prose or regenerate via pnpm gen:mcp-tools-doc\n')
  process.exit(1)
}

console.log(`✓ MCP prose tool counts match catalog (${expected})`)
