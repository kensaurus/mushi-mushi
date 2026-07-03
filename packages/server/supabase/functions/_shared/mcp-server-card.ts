/**
 * Static MCP server card for directory scanners (Smithery, SEP-1649).
 * Served at `/.well-known/mcp/server-card.json` when live tool scan is blocked by auth.
 *
 * Smithery quality score weights: tool descriptions, inputSchema depth, server metadata,
 * repository/homepage/license links.
 *
 * Tool list is sourced from mcp-discovery-tools.json, NOT mcp-hosted-tool-manifest.json:
 * the latter only covers the subset of tools built at runtime via buildManifestTools()
 * and omits tools hand-coded in mcp/index.ts's BASE_TOOLS (get_fix_context, dispatch_fix,
 * ...), so a card built from it alone under-advertises the real hosted server. Regenerate
 * mcp-discovery-tools.json with `node scripts/sync-mcp-discovery-card.mjs` whenever the
 * canonical catalog (packages/mcp/src/catalog.ts) changes.
 */

import manifestRaw from './mcp-discovery-tools.json' with { type: 'json' }
import { SERVER_INFO_EXTENDED } from './mcp-branding.ts'

const SMITHERY_SERVER_URL = 'https://smithery.ai/servers/kensaurus/mushi-mushi'
const PRODUCT_HOMEPAGE = 'https://kensaur.us/mushi-mushi/docs/connect'
const REPOSITORY = 'https://github.com/kensaurus/mushi-mushi'

type ManifestEntry = {
  description: string
  scope?: string
  required?: string[]
}

/** Map manifest `required` keys to JSON Schema properties Smithery can score. */
function inputSchemaFromManifest(entry: ManifestEntry): Record<string, unknown> {
  const required = entry.required ?? []
  const properties: Record<string, unknown> = {}
  for (const name of required) {
    properties[name] = {
      type: 'string',
      description: `Required parameter \`${name}\` for ${entry.description.split('.')[0]}.`,
    }
  }
  return {
    type: 'object',
    properties,
    ...(required.length ? { required } : {}),
    additionalProperties: false,
  }
}

export const MUSHI_SMITHERY_CONFIG_SCHEMA = {
  type: 'object',
  properties: {
    mushiApiKey: {
      type: 'string',
      title: 'Mushi API key',
      description: 'Mint at kensaur.us/mushi-mushi/docs/connect (mcp:read scope)',
      'x-from': { header: 'x-mushi-api-key' },
    },
    mushiProjectId: {
      type: 'string',
      title: 'Project ID',
      description: 'Optional UUID when your key spans multiple projects',
      'x-from': { header: 'x-mushi-project-id' },
      'x-to': { header: 'X-Mushi-Project-Id' },
    },
  },
  required: ['mushiApiKey'],
} as const

export function buildMcpServerCard(): Record<string, unknown> {
  const manifest = manifestRaw as Record<string, ManifestEntry>
  const tools = Object.entries(manifest)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, spec]) => ({
      name,
      title: name.replace(/_/g, ' '),
      description: spec.description,
      inputSchema: inputSchemaFromManifest(spec),
    }))

  return {
    serverInfo: {
      name: SERVER_INFO_EXTENDED.title,
      version: SERVER_INFO_EXTENDED.version,
      description:
        'Your AI shipped it. Mushi tells you why it broke — plain diagnosis and a paste-ready fix prompt in Cursor. No second LLM key.',
      homepage: PRODUCT_HOMEPAGE,
      repository: REPOSITORY,
      license: 'MIT',
    },
    authentication: {
      required: true,
      schemes: ['apiKey'],
    },
    configSchema: MUSHI_SMITHERY_CONFIG_SCHEMA,
    tools,
    resources: [],
    prompts: [],
    links: {
      connect: PRODUCT_HOMEPAGE,
      docs: 'https://kensaur.us/mushi-mushi/docs/quickstart/mcp',
      smithery: SMITHERY_SERVER_URL,
      repository: REPOSITORY,
    },
  }
}

export const MCP_SERVER_CARD_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'public, max-age=3600, s-maxage=3600',
  'Access-Control-Allow-Origin': '*',
}
