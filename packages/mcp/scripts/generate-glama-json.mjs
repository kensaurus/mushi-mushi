#!/usr/bin/env node
/**
 * FILE: packages/mcp/scripts/generate-glama-json.mjs
 * PURPOSE: Regenerate the repo-root glama.json `tools[]` array (the `vibe`
 *          preset, PRESET_TOOLS in feature-groups.ts) and the two tool counts
 *          in its `description` from the canonical catalog
 *          (packages/mcp/src/catalog.ts, compiled to dist/catalog.js).
 *
 *          Glama displays the declared tool list; keeping it derived from the
 *          catalog means a rename/removal can never silently desync the public
 *          manifest from what `npx @mushi-mushi/mcp` actually advertises.
 *
 *          Build first:  pnpm --filter @mushi-mushi/mcp build
 *          Generate:     node packages/mcp/scripts/generate-glama-json.mjs
 *          --check mode: exits 1 if glama.json is out of sync (used in CI)
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pathToFileURL } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PKG_ROOT = resolve(__dirname, '..')
const REPO_ROOT = resolve(PKG_ROOT, '..', '..')
const CHECK_MODE = process.argv.includes('--check')

const catalogUrl = pathToFileURL(resolve(PKG_ROOT, 'dist/catalog.js')).href
const { TOOL_CATALOG, TDD_TOOL_CATALOG, CODEBASE_TOOL_CATALOG } = await import(catalogUrl)
const featureGroupsUrl = pathToFileURL(resolve(PKG_ROOT, 'dist/feature-groups.js')).href
const { PRESET_TOOLS } = await import(featureGroupsUrl)

// Directory listings show the `vibe` preset, the tool set new installs get
// (ADR 0063): Glama scores tool count, and the full list scored 1/5. Glama's
// own build spec (in its admin, not the repo Dockerfile) sets
// MUSHI_FEATURES=vibe, so the declared list matches what its inspection sees.
// `features=all` still lists every tool; the description names both counts.
const allTools = [...TOOL_CATALOG, ...TDD_TOOL_CATALOG, ...CODEBASE_TOOL_CATALOG]
const vibe = new Set(PRESET_TOOLS.vibe)
const tools = allTools
  .filter((t) => vibe.has(t.name))
  .map((t) => ({ name: t.name, description: t.description }))
if (tools.length !== vibe.size) {
  console.error(`✗ PRESET_TOOLS.vibe names ${vibe.size} tools but only ${tools.length} are in the catalog.`)
  process.exit(1)
}

const glamaPath = resolve(REPO_ROOT, 'glama.json')
const current = JSON.parse(readFileSync(glamaPath, 'utf8'))

const next = {
  ...current,
  description: current.description
    .replace(/\b\d+ tools by default\b/, `${tools.length} tools by default`)
    .replace(/\bfeatures=all lists \d+ tools\b/, `features=all lists ${allTools.length} tools`),
  tools,
}

const serialized = JSON.stringify(next, null, 2) + '\n'
const existing = readFileSync(glamaPath, 'utf8')

if (CHECK_MODE) {
  if (serialized !== existing) {
    console.error('\n✗ glama.json is out of sync with the catalog.')
    console.error('  Run: pnpm --filter @mushi-mushi/mcp build && node packages/mcp/scripts/generate-glama-json.mjs\n')
    process.exit(1)
  }
  console.log(`✓ glama.json in sync: ${tools.length} tools`)
  process.exit(0)
}

writeFileSync(glamaPath, serialized, 'utf8')
console.log(`✓ Wrote glama.json: ${tools.length} tools`)
