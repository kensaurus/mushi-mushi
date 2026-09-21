/**
 * Static MCP server card for directory scanners (Smithery, SEP-1649).
 * Served at `/.well-known/mcp/server-card.json` when live tool scan is blocked by auth.
 *
 * Smithery quality score weights: tool descriptions, inputSchema depth, server metadata,
 * repository/homepage/license links.
 *
 * Everything tool-shaped comes from mcp-discovery-tools.json, generated from the
 * canonical stdio catalog and the zod schemas it registers
 * (`node scripts/sync-mcp-discovery-card.mjs`, CI: --check): titles, annotations,
 * input and output schemas, resources, prompts and the package version. The card
 * used to advertise every tool with an empty input schema, no annotations, titles
 * made by name.replace, version 2.0.0, and API-key auth only — so scanners hid the
 * OAuth sign-in the product is built around.
 */

import { PUBLIC_CORS_HEADERS } from './cors.ts'
import discoveryRaw from './mcp-discovery-tools.json' with { type: 'json' }

const SMITHERY_SERVER_URL = 'https://smithery.ai/servers/kensaurus/mushi-mushi'
const PRODUCT_HOMEPAGE = 'https://kensaur.us/mushi-mushi/docs/connect'
const REPOSITORY = 'https://github.com/kensaurus/mushi-mushi'
const MCP_QUICKSTART = 'https://kensaur.us/mushi-mushi/docs/quickstart/mcp'

export interface DiscoveryTool {
  title: string
  description: string
  scope: 'mcp:read' | 'mcp:write'
  annotations?: Record<string, unknown>
  inputSchema: Record<string, unknown>
  outputSchema?: Record<string, unknown>
  returnsUntrusted?: boolean
}

export interface McpDiscovery {
  /** `@mushi-mushi/mcp@<version>` the metadata was generated from (kept current by sync-mcp-pin). */
  packagePin: string
  tools: Record<string, DiscoveryTool>
  resources: Array<{ name: string; uri: string; title: string; description: string }>
  prompts: Array<{ name: string; description: string }>
}

/** Canonical tool metadata, generated from packages/mcp — see the module doc. */
export const MCP_DISCOVERY = discoveryRaw as McpDiscovery

/** The @mushi-mushi/mcp version this deploy's catalog comes from, e.g. 0.21.0. */
export function mcpPackageVersion(): string {
  return MCP_DISCOVERY.packagePin.slice(MCP_DISCOVERY.packagePin.lastIndexOf('@') + 1)
}

export const MUSHI_SMITHERY_CONFIG_SCHEMA = {
  type: 'object',
  properties: {
    mushiApiKey: {
      type: 'string',
      title: 'Mushi API key',
      description:
        'Optional when your client signs in with OAuth. Otherwise mint one at kensaur.us/mushi-mushi/docs/connect (mcp:read scope).',
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
} as const

/** Where the OAuth flow for this deployment is described, as seen by the requesting client. */
export interface ServerCardOAuth {
  /** OAuth issuer / authorization server (RFC 8414). */
  authorizationServer: string
  /** RFC 9728 Protected Resource Metadata URL. */
  resourceMetadata: string
}

export function buildMcpServerCard(oauth?: ServerCardOAuth): Record<string, unknown> {
  const tools = Object.entries(MCP_DISCOVERY.tools)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, spec]) => ({
      name,
      title: spec.title,
      description: spec.description,
      inputSchema: spec.inputSchema,
      ...(spec.outputSchema ? { outputSchema: spec.outputSchema } : {}),
      ...(spec.annotations ? { annotations: spec.annotations } : {}),
    }))

  return {
    serverInfo: {
      name: 'Mushi Mushi',
      version: mcpPackageVersion(),
      description:
        'Your AI shipped it. Mushi tells you why it broke — plain diagnosis and a paste-ready fix prompt in Cursor. No second LLM key.',
      homepage: PRODUCT_HOMEPAGE,
      repository: REPOSITORY,
      license: 'MIT',
    },
    authentication: {
      required: true,
      // OAuth first: MCP clients discover it from the 401 challenge and sign
      // the user in; a project API key header remains the fallback. OAuth is
      // advertised only by a caller that can name the authorization server
      // and PRM URL for the requesting URL — an oauth2 block with neither
      // would point scanners at a flow with no issuer.
      schemes: oauth ? ['oauth2', 'apiKey'] : ['apiKey'],
      ...(oauth
        ? {
            oauth2: {
              ...oauth,
              scopes: ['mcp:read', 'mcp:write'],
              documentation: MCP_QUICKSTART,
            },
          }
        : {}),
      apiKey: { header: 'X-Mushi-Api-Key', alternative: 'Authorization: Bearer mushi_…' },
    },
    configSchema: MUSHI_SMITHERY_CONFIG_SCHEMA,
    tools,
    resources: MCP_DISCOVERY.resources.map(({ name, uri, title, description }) => ({
      name,
      uri,
      title,
      description,
      mimeType: 'application/json',
    })),
    prompts: MCP_DISCOVERY.prompts,
    links: {
      connect: PRODUCT_HOMEPAGE,
      docs: MCP_QUICKSTART,
      smithery: SMITHERY_SERVER_URL,
      repository: REPOSITORY,
    },
  }
}

export const MCP_SERVER_CARD_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'public, max-age=3600, s-maxage=3600',
  // The oauth2 block names the URL the request came in on.
  Vary: 'X-Forwarded-Host, X-Amz-Cf-Id, Via',
  ...PUBLIC_CORS_HEADERS,
}
