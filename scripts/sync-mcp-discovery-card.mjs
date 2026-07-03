#!/usr/bin/env node
/**
 * FILE: scripts/sync-mcp-discovery-card.mjs
 * PURPOSE: Regenerates mcp-discovery-tools.json — the tool list served by the
 *          static, unauthenticated MCP server-card
 *          (.well-known/mcp/server-card.json) that directory scanners like
 *          Smithery read *before* a client ever authenticates.
 *
 *          Root cause this fixes: the server-card used to read directly from
 *          mcp-hosted-tool-manifest.json (51 entries), which under-represents
 *          the real hosted MCP because most tools (get_fix_context,
 *          dispatch_fix, etc.) are hand-coded in mcp/index.ts's BASE_TOOLS and
 *          never appear in that file. mcp-hosted-tool-manifest.json can't
 *          simply be widened to include them: it *also* feeds
 *          buildManifestTools() at runtime, and adding an entry with a name
 *          that collides with a BASE_TOOLS handler would silently shadow the
 *          real implementation (buildManifestTools() output is spread after
 *          BASE_TOOLS). mcp-discovery-tools.json is a separate, card-only
 *          artifact generated from the canonical catalog
 *          (packages/mcp/src/catalog.ts) so the public listing can never omit
 *          a real tool again, without touching the runtime tool-routing file.
 *
 *          Run: pnpm --filter @mushi-mushi/mcp build && node scripts/sync-mcp-discovery-card.mjs
 *          --check mode: exits 1 if the file is out of sync (used in CI)
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const CHECK_MODE = process.argv.includes('--check')

const catalogDistPath = resolve(ROOT, 'packages/mcp/dist/catalog.js')
if (!existsSync(catalogDistPath)) {
  console.error(`✗ ${catalogDistPath} not found — run "pnpm --filter @mushi-mushi/mcp build" first.`)
  process.exit(1)
}

const { TOOL_CATALOG, TDD_TOOL_CATALOG, CODEBASE_TOOL_CATALOG } = await import(catalogDistPath)
const canonicalTools = [...TOOL_CATALOG, ...TDD_TOOL_CATALOG, ...CODEBASE_TOOL_CATALOG]

const manifestPath = resolve(
  ROOT,
  'packages/server/supabase/functions/_shared/mcp-hosted-tool-manifest.json',
)
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))

const outPath = resolve(ROOT, 'packages/server/supabase/functions/_shared/mcp-discovery-tools.json')

const discoveryTools = {}
for (const tool of [...canonicalTools].sort((a, b) => a.name.localeCompare(b.name))) {
  const entry = { description: tool.description, scope: tool.scope }
  // Reuse the manifest's `required` list where one already exists — gives
  // Smithery's quality scorer real inputSchema depth for those tools instead
  // of an empty properties object, with zero risk to the runtime tool router.
  const required = manifest[tool.name]?.required
  if (required?.length) entry.required = required
  discoveryTools[tool.name] = entry
}

const generated = `${JSON.stringify(discoveryTools, null, 2)}\n`

if (CHECK_MODE) {
  const current = existsSync(outPath) ? readFileSync(outPath, 'utf8') : null
  if (current !== generated) {
    console.error(`\n✗ mcp-discovery-tools.json is out of sync with the canonical catalog.`)
    console.error(`  Run: node scripts/sync-mcp-discovery-card.mjs\n`)
    process.exit(1)
  }
  console.log(`✓ mcp-discovery-tools.json in sync: ${Object.keys(discoveryTools).length} tools`)
  process.exit(0)
}

writeFileSync(outPath, generated, 'utf8')
console.log(`✓ Wrote mcp-discovery-tools.json: ${Object.keys(discoveryTools).length} tools`)
