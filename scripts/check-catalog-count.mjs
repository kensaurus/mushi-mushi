#!/usr/bin/env node
/**
 * check-catalog-count.mjs
 *
 * Counts MCP **tools** in packages/mcp/src/catalog.ts (TOOL_CATALOG +
 * TDD_TOOL_CATALOG + CODEBASE_TOOL_CATALOG) and asserts that glama.json and
 * smithery.yaml mention the same tool count. Resources and prompts are
 * counted separately for logging — they must not be marketed as "tools".
 *
 * Usage:
 *   node scripts/check-catalog-count.mjs
 *   node scripts/check-catalog-count.mjs --fix   # auto-update glama.json
 *
 * Why: catalog.ts also declares RESOURCE_CATALOG + PROMPT_CATALOG. A naive
 * `name:` count inflated the marketplace listing to "80 tools" while the
 * generated docs correctly say "68 tools · 8 resources · 4 prompts".
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const FIX = process.argv.includes('--fix')

const TOOL_EXPORTS = ['TOOL_CATALOG', 'TDD_TOOL_CATALOG', 'CODEBASE_TOOL_CATALOG']
const RESOURCE_EXPORTS = ['RESOURCE_CATALOG']
const PROMPT_EXPORTS = ['PROMPT_CATALOG']

/** Count `name: '…'` entries inside one `export const NAME = […]` block. */
function countNamesInExport(src, exportName) {
  const marker = `export const ${exportName}`
  const start = src.indexOf(marker)
  if (start < 0) return 0
  const bracket = src.indexOf('[', start)
  if (bracket < 0) return 0
  const nextExport = src.indexOf('\nexport const ', bracket + 1)
  const slice = nextExport > 0 ? src.slice(bracket, nextExport) : src.slice(bracket)
  return (slice.match(/\bname:\s*['"][a-z_][a-z0-9_]*['"]/g) ?? []).length
}

function sumExports(src, names) {
  return names.reduce((n, name) => n + countNamesInExport(src, name), 0)
}

// ─── 1. Count tools / resources / prompts in catalog.ts ─────────────────────

const catalogPath = join(ROOT, 'packages', 'mcp', 'src', 'catalog.ts')
const catalogSrc = readFileSync(catalogPath, 'utf8')

const toolCount = sumExports(catalogSrc, TOOL_EXPORTS)
const resourceCount = sumExports(catalogSrc, RESOURCE_EXPORTS)
const promptCount = sumExports(catalogSrc, PROMPT_EXPORTS)

console.log(
  `catalog.ts: ${toolCount} tools · ${resourceCount} resources · ${promptCount} prompts`
)

if (toolCount === 0) {
  console.error('✗ Failed to parse any tools from catalog.ts — check TOOL_* exports.')
  process.exit(1)
}

let hasError = false

/** Replace the first `N tools` / `N tool` mention in a string. */
function replaceToolCount(src, count) {
  return src.replace(/(\d+)\s+(tools?)/, `${count} $2`)
}

// ─── 2. Check glama.json ─────────────────────────────────────────────────────

const glamaPath = join(ROOT, 'glama.json')
const glamaSrc = readFileSync(glamaPath, 'utf8')
const glamaCountMatch = glamaSrc.match(/(\d+)\s+tools?/)
const glamaCount = glamaCountMatch ? parseInt(glamaCountMatch[1], 10) : null

if (glamaCount !== toolCount) {
  if (FIX) {
    const updated = replaceToolCount(glamaSrc, toolCount)
    writeFileSync(glamaPath, updated, 'utf8')
    console.log(`✓ glama.json updated from ${glamaCount} to ${toolCount} tools.`)
  } else {
    console.error(
      `✗ glama.json says "${glamaCount} tools" but catalog.ts has ${toolCount} tools` +
        ` (${resourceCount} resources · ${promptCount} prompts are separate).\n` +
        `  Fix: run "node scripts/check-catalog-count.mjs --fix" or update glama.json manually.`
    )
    hasError = true
  }
} else {
  console.log(`✓ glama.json tool count matches (${toolCount}).`)
}

// ─── 3. Check smithery.yaml (if it mentions a count) ─────────────────────────

const smitheryPath = join(ROOT, 'smithery.yaml')
try {
  const smitherySrc = readFileSync(smitheryPath, 'utf8')
  const smitheryCountMatch = smitherySrc.match(/(\d+)\s+tools?/)
  if (smitheryCountMatch) {
    const smitheryCount = parseInt(smitheryCountMatch[1], 10)
    if (smitheryCount !== toolCount) {
      if (FIX) {
        const updated = replaceToolCount(smitherySrc, toolCount)
        writeFileSync(smitheryPath, updated, 'utf8')
        console.log(`✓ smithery.yaml updated from ${smitheryCount} to ${toolCount} tools.`)
      } else {
        console.error(
          `✗ smithery.yaml says "${smitheryCount} tools" but catalog.ts has ${toolCount}.\n` +
            `  Fix: run "node scripts/check-catalog-count.mjs --fix".`
        )
        hasError = true
      }
    } else {
      console.log(`✓ smithery.yaml tool count matches (${toolCount}).`)
    }
  } else {
    console.log(`  smithery.yaml: no tool count mention found — skipping.`)
  }
} catch {
  console.log(`  smithery.yaml not found — skipping.`)
}

// ─── 4. Soft-check AGENTS.md + generated MDX for "N tools" ───────────────────

for (const rel of [
  'AGENTS.md',
  'apps/docs/content/sdks/mcp-tools.generated.mdx',
]) {
  try {
    const src = readFileSync(join(ROOT, rel), 'utf8')
    const m = src.match(/\*\*(\d+)\s+tools?\*\*|\b(\d+)\s+tools?\b/)
    const mentioned = m ? parseInt(m[1] || m[2], 10) : null
    if (mentioned != null && mentioned !== toolCount) {
      console.warn(
        `⚠  ${rel} mentions "${mentioned} tools" but catalog has ${toolCount}.`
      )
    } else if (mentioned === toolCount) {
      console.log(`✓ ${rel} tool count matches (${toolCount}).`)
    }
  } catch {
    /* optional */
  }
}

// ─── 5. Exit ─────────────────────────────────────────────────────────────────

if (hasError) process.exit(1)
console.log('\n✓ Catalog count check passed.')
