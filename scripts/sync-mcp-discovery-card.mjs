#!/usr/bin/env node
/**
 * FILE: scripts/sync-mcp-discovery-card.mjs
 * PURPOSE: Regenerates mcp-discovery-tools.json — the hosted MCP's copy of
 *          the canonical tool metadata. The stdio server (packages/mcp) is
 *          the source: its catalog.ts plus the zod schemas it registers. The
 *          Deno edge function cannot import that package, so this file
 *          carries what it needs:
 *
 *            - the static server card (.well-known/mcp/server-card.json)
 *              that directory scanners like Smithery read before a client
 *              ever authenticates: titles, annotations, input and output
 *              schemas, resources, prompts, and the package version;
 *            - the hosted tools/list, which overlays each tool's title,
 *              description and annotations from here, and gives manifest
 *              tools their real input schema instead of an empty object.
 *
 *          The server card used to read mcp-hosted-tool-manifest.json, which
 *          omits every tool hand-coded in mcp/index.ts's BASE_TOOLS, and then
 *          a names-and-descriptions-only file, so every tool was advertised
 *          with an empty input schema and no annotations.
 *
 *          Run: pnpm --filter @mushi-mushi/mcp build && node scripts/sync-mcp-discovery-card.mjs
 *          --check mode: exits 1 if the file is out of sync (used in CI)
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const CHECK_MODE = process.argv.includes('--check')

const distDir = resolve(ROOT, 'packages/mcp/dist')
for (const file of ['catalog.js', 'server.js']) {
  if (!existsSync(resolve(distDir, file))) {
    console.error(`✗ packages/mcp/dist/${file} not found — run "pnpm --filter @mushi-mushi/mcp build" first.`)
    process.exit(1)
  }
}

// pathToFileURL: a bare absolute path is not a valid ESM specifier on
// Windows (the drive letter parses as a URL scheme).
const { TOOL_CATALOG, TDD_TOOL_CATALOG, CODEBASE_TOOL_CATALOG, RESOURCE_CATALOG, PROMPT_CATALOG } = await import(
  pathToFileURL(resolve(distDir, 'catalog.js')).href
)
const { createMushiServer } = await import(pathToFileURL(resolve(distDir, 'server.js')).href)
const canonicalTools = [...TOOL_CATALOG, ...TDD_TOOL_CATALOG, ...CODEBASE_TOOL_CATALOG]
const packageVersion = JSON.parse(readFileSync(resolve(ROOT, 'packages/mcp/package.json'), 'utf8')).version

/**
 * The JSON schemas the stdio server actually advertises, read from its own
 * tools/list handler so the zod → JSON Schema conversion is the SDK's.
 * No transport, no network: the server never calls the API to list tools.
 */
async function listStdioTools() {
  const server = createMushiServer({
    version: packageVersion,
    apiEndpoint: 'https://sync-mcp-discovery-card.invalid',
    apiKey: 'sync-mcp-discovery-card',
    features: 'all',
  })
  const handler = server.server._requestHandlers.get('tools/list')
  if (typeof handler !== 'function') throw new Error('stdio server exposes no tools/list handler')
  const res = await handler(
    { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
    { signal: new AbortController().signal, requestId: 1, sendNotification: async () => {}, sendRequest: async () => {} },
  )
  return new Map(res.tools.map((t) => [t.name, t]))
}

/** Drop the per-schema `$schema` marker: it repeats on every tool and the card is served uncompressed. */
function compactSchema(schema) {
  if (!schema || typeof schema !== 'object') return schema
  const { $schema: _ignored, ...rest } = schema
  return rest
}

const stdioTools = await listStdioTools()
const tools = {}
for (const spec of [...canonicalTools].sort((a, b) => a.name.localeCompare(b.name))) {
  const listed = stdioTools.get(spec.name)
  if (!listed) {
    console.error(`✗ catalog tool "${spec.name}" is not registered by createMushiServer — fix server.ts first.`)
    process.exit(1)
  }
  tools[spec.name] = {
    title: spec.title,
    description: spec.description,
    scope: spec.scope,
    annotations: listed.annotations,
    inputSchema: compactSchema(listed.inputSchema),
    ...(listed.outputSchema ? { outputSchema: compactSchema(listed.outputSchema) } : {}),
    ...(spec.returnsUntrusted ? { returnsUntrusted: true } : {}),
  }
}

const discovery = {
  // A pin literal, so scripts/sync-mcp-pin.mjs keeps it current on every
  // changeset version bump without rebuilding packages/mcp.
  packagePin: `@mushi-mushi/mcp@${packageVersion}`,
  tools,
  resources: RESOURCE_CATALOG.map(({ name, uri, title, description }) => ({ name, uri, title, description })),
  prompts: PROMPT_CATALOG.map(({ name, description }) => ({ name, description })),
}

const outPath = resolve(ROOT, 'packages/server/supabase/functions/_shared/mcp-discovery-tools.json')
const generated = `${JSON.stringify(discovery, null, 2)}\n`
const summary = `${Object.keys(tools).length} tools, ${discovery.resources.length} resources, ${discovery.prompts.length} prompts`

if (CHECK_MODE) {
  const current = existsSync(outPath) ? readFileSync(outPath, 'utf8').replace(/\r\n/g, '\n') : null
  if (current !== generated) {
    console.error(`\n✗ mcp-discovery-tools.json is out of sync with the canonical catalog.`)
    console.error(`  Run: pnpm --filter @mushi-mushi/mcp build && node scripts/sync-mcp-discovery-card.mjs\n`)
    process.exit(1)
  }
  console.log(`✓ mcp-discovery-tools.json in sync: ${summary}`)
  process.exit(0)
}

writeFileSync(outPath, generated, 'utf8')
console.log(`✓ Wrote mcp-discovery-tools.json: ${summary}`)
