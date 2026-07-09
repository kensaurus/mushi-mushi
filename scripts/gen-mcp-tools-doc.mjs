#!/usr/bin/env node
/**
 * Generate the MCP tool reference MDX from the built @mushi-mushi/mcp catalog.
 *
 *   pnpm gen:mcp-tools-doc
 *   pnpm gen:mcp-tools-doc --check   # fail if generated MDX is stale
 *
 * Imports the REAL catalog from packages/mcp/dist (build it first:
 * `pnpm --filter @mushi-mushi/mcp build`) instead of regex-scraping the
 * TypeScript source. The previous source-scraper mis-parsed multi-line
 * concatenated descriptions (leaking `undefined`, `' +`, and `scope:` into the
 * output) and produced MDX that acorn could not parse. Reading the compiled
 * catalog is the single source of truth and stays correct as fields evolve.
 */

import { writeFileSync, readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const CATALOG_DIST = path.join(ROOT, 'packages/mcp/dist/catalog.js')
const OUT = path.join(ROOT, 'apps/docs/content/sdks/mcp-tools.generated.mdx')
const CHECK_MODE = process.argv.includes('--check')

let catalog
try {
  catalog = await import(pathToFileURL(CATALOG_DIST).href)
} catch (err) {
  console.error(
    `gen-mcp-tools-doc: could not import ${path.relative(ROOT, CATALOG_DIST)}.\n` +
      'Build the MCP package first: pnpm --filter @mushi-mushi/mcp build\n' +
      String(err instanceof Error ? err.message : err),
  )
  process.exit(1)
}

const {
  TOOL_CATALOG = [],
  TDD_TOOL_CATALOG = [],
  CODEBASE_TOOL_CATALOG = [],
  RESOURCE_CATALOG = [],
  PROMPT_CATALOG = [],
} = catalog

const tools = [...TOOL_CATALOG, ...TDD_TOOL_CATALOG, ...CODEBASE_TOOL_CATALOG]
const resources = RESOURCE_CATALOG
const prompts = PROMPT_CATALOG

const readTools = tools.filter((t) => (t.scope ?? 'mcp:read') === 'mcp:read')
const writeTools = tools.filter((t) => t.scope === 'mcp:write')

/**
 * Escape a value for a Markdown/MDX *table cell*:
 *  - collapse all whitespace/newlines (cells are single-line)
 *  - escape backslashes FIRST so the escapes we add below cannot be subverted
 *    by a backslash already present in the input (js/incomplete-sanitization)
 *  - escape the pipe (table column delimiter)
 *  - escape `{` and `<`, which MDX otherwise parses as a JS expression / JSX
 *    tag (the cause of "Could not parse expression with acorn").
 */
function esc(cell) {
  return String(cell ?? '')
    .replace(/\s+/g, ' ')
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/\{/g, '\\{')
    .replace(/</g, '\\<')
    .trim()
}

const body = `---
title: MCP tools (generated)
---

import { Callout } from 'nextra/components'

# MCP tools (generated)

<Callout type="warning">
  Auto-generated from \`packages/mcp/src/catalog.ts\`. Do not edit by hand — run \`pnpm gen:mcp-tools-doc\`.
</Callout>

**${tools.length} tools** · **${resources.length} resources** · **${prompts.length} prompts**

## Read tools (\`mcp:read\`)

| Tool | Title | Description |
|------|-------|-------------|
${readTools.map((t) => `| \`${esc(t.name)}\` | ${esc(t.title ?? t.name)} | ${esc(t.description)} |`).join('\n')}

## Write tools (\`mcp:write\`)

| Tool | Title | Description |
|------|-------|-------------|
${writeTools.map((t) => `| \`${esc(t.name)}\` | ${esc(t.title ?? t.name)} | ${esc(t.description)} |`).join('\n')}

## Resources

| Name | URI | Description |
|------|-----|-------------|
${resources.map((r) => `| ${esc(r.name)} | \`${esc(r.uri)}\` | ${esc(r.description)} |`).join('\n')}

## Prompts

| Prompt | Description |
|--------|-------------|
${prompts.map((p) => `| \`${esc(p.name)}\` | ${esc(p.description)} |`).join('\n')}
`

if (CHECK_MODE) {
  if (!existsSync(OUT)) {
    console.error(`✗ ${path.relative(ROOT, OUT)} missing — run pnpm gen:mcp-tools-doc`)
    process.exit(1)
  }
  const existing = readFileSync(OUT, 'utf8')
  if (existing !== body) {
    console.error(
      `✗ ${path.relative(ROOT, OUT)} is stale vs packages/mcp/dist/catalog.js\n` +
        '  Run: pnpm gen:mcp-tools-doc\n',
    )
    process.exit(1)
  }
  console.log(
    `✓ mcp-tools.generated.mdx in sync (${tools.length} tools, ${resources.length} resources, ${prompts.length} prompts)`,
  )
  process.exit(0)
}

writeFileSync(OUT, body, 'utf8')
console.log(
  `Wrote ${path.relative(ROOT, OUT)} (${tools.length} tools, ${resources.length} resources, ${prompts.length} prompts)`,
)
