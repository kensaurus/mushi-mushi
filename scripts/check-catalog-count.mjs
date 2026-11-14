#!/usr/bin/env node
/**
 * check-catalog-count.mjs
 *
 * Counts MCP **tools** in packages/mcp/src/catalog.ts (TOOL_CATALOG +
 * TDD_TOOL_CATALOG + CODEBASE_TOOL_CATALOG) and asserts that glama.json
 * lists the `vibe` preset and names both counts (the preset, and the whole
 * catalog under features=all). (smithery.yaml was removed on 2026-11-14:
 * Smithery shut down its hosted services on 2026-10-31.) Resources and prompts are
 * counted separately for logging — they must not be marketed as "tools".
 *
 * Usage:
 *   node scripts/check-catalog-count.mjs
 *   node scripts/check-catalog-count.mjs --fix   # auto-update glama.json
 *
 * Why: catalog.ts also declares RESOURCE_CATALOG + PROMPT_CATALOG. A naive
 * `name:` count inflated the marketplace listing to "80 tools" while the
 * generated docs correctly report tools, resources, and prompts separately.
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

// ─── 2. Check glama.json ─────────────────────────────────────────────────────
//
// glama.json lists the `vibe` preset (PRESET_TOOLS.vibe in feature-groups.ts),
// the tool set new installs and directory listings get, and its description
// names two counts: "<N> tools by default" (the preset) and
// "features=all lists <M> tools" (the whole catalog).

const featureGroupsSrc = readFileSync(join(ROOT, 'packages', 'mcp', 'src', 'feature-groups.ts'), 'utf8')
const vibeBlock = /\bvibe:\s*\[([\s\S]*?)\]/.exec(featureGroupsSrc)
const vibeTools = vibeBlock ? [...vibeBlock[1].matchAll(/'([a-z_][a-z0-9_]*)'/g)].map((m) => m[1]) : []
if (vibeTools.length === 0) {
  console.error('✗ Failed to parse PRESET_TOOLS.vibe from feature-groups.ts.')
  process.exit(1)
}

const glamaPath = join(ROOT, 'glama.json')
let glamaSrc = readFileSync(glamaPath, 'utf8')
const glama = JSON.parse(glamaSrc)
const defaultMatch = /(\d+) tools by default/.exec(glama.description ?? '')
const allMatch = /features=all lists (\d+) tools/.exec(glama.description ?? '')
const defaultCount = defaultMatch ? parseInt(defaultMatch[1], 10) : null
const allCount = allMatch ? parseInt(allMatch[1], 10) : null

if (defaultCount !== vibeTools.length || allCount !== toolCount) {
  if (FIX && defaultMatch && allMatch) {
    glamaSrc = glamaSrc
      .replace(/\d+ tools by default/, `${vibeTools.length} tools by default`)
      .replace(/features=all lists \d+ tools/, `features=all lists ${toolCount} tools`)
    writeFileSync(glamaPath, glamaSrc, 'utf8')
    console.log(`✓ glama.json counts updated to ${vibeTools.length} by default / ${toolCount} with features=all.`)
  } else {
    console.error(
      `✗ glama.json description says "${defaultCount} tools by default" and "features=all lists ${allCount} tools";` +
        ` expected ${vibeTools.length} (PRESET_TOOLS.vibe) and ${toolCount} (catalog.ts;` +
        ` ${resourceCount} resources · ${promptCount} prompts are separate).\n` +
        `  Fix: run "node scripts/check-catalog-count.mjs --fix" or update glama.json manually.`
    )
    hasError = true
  }
} else {
  console.log(`✓ glama.json counts match (${vibeTools.length} by default, ${toolCount} with features=all).`)
}

const listed = (glama.tools ?? []).map((t) => t.name)
const missing = vibeTools.filter((name) => !listed.includes(name))
const extra = listed.filter((name) => !vibeTools.includes(name))
if (missing.length || extra.length) {
  console.error(
    `✗ glama.json tools[] must be exactly PRESET_TOOLS.vibe.` +
      (missing.length ? ` Missing: ${missing.join(', ')}.` : '') +
      (extra.length ? ` Extra: ${extra.join(', ')}.` : '') +
      `\n  Fix: pnpm --filter @mushi-mushi/mcp build && node packages/mcp/scripts/generate-glama-json.mjs`
  )
  hasError = true
} else {
  console.log(`✓ glama.json tools[] is the vibe preset (${listed.length}).`)
}

// ─── 3. Soft-check AGENTS.md + generated MDX for "N tools" ───────────────────

for (const rel of [
  'AGENTS.md',
  'apps/docs/content/sdks/mcp-tools.mdx',
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
