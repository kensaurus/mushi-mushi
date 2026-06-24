/**
 * Static MCP server card for directory scanners (Smithery, SEP-1649).
 * Served at `/.well-known/mcp/server-card.json` when live tool scan is blocked by auth.
 */

import manifestRaw from '../mcp/hosted-tool-manifest.json' with { type: 'json' }
import { SERVER_INFO_EXTENDED } from '../mcp/branding.ts'

type ManifestEntry = { description: string }

/** Hand-authored + manifest tools we want directory pages to highlight first. */
const LEAN_TOOL_CATALOG: Array<{ name: string; description: string }> = [
  {
    name: 'get_recent_reports',
    description: 'List recent user-reported bugs with severity and status.',
  },
  {
    name: 'get_fix_context',
    description: 'Paste-ready fix packet: root cause, repro steps, and suggested prompt.',
  },
  {
    name: 'summarize_report_for_fix',
    description: 'Plain-English summary of a report for your coding agent.',
  },
  {
    name: 'diagnose_connection',
    description: 'Validate your API key and project setup before first use.',
  },
  {
    name: 'list_qa_story_runs',
    description: 'Recent Playwright QA story runs and pass/fail status.',
  },
  {
    name: 'search_codebase',
    description: 'Semantic search across your indexed repository.',
  },
  {
    name: 'ask_codebase',
    description: 'Ask a plain-English question about your indexed codebase.',
  },
]

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
  const leanNames = new Set(LEAN_TOOL_CATALOG.map((t) => t.name))
  const fromManifest = Object.entries(manifest)
    .filter(([name]) => !leanNames.has(name))
    .slice(0, 12)
    .map(([name, spec]) => ({
      name,
      description: spec.description,
      inputSchema: { type: 'object', properties: {} },
    }))

  const tools = [
    ...LEAN_TOOL_CATALOG.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: { type: 'object', properties: {} },
    })),
    ...fromManifest,
  ]

  return {
    serverInfo: {
      name: SERVER_INFO_EXTENDED.title,
      version: SERVER_INFO_EXTENDED.version,
      description:
        'Your AI shipped it. Mushi tells you why it broke — plain diagnosis and a paste-ready fix prompt in Cursor. No second LLM key.',
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
      connect: 'https://kensaur.us/mushi-mushi/docs/connect',
      docs: 'https://kensaur.us/mushi-mushi/docs/quickstart/mcp',
    },
  }
}

export const MCP_SERVER_CARD_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'public, max-age=3600, s-maxage=3600',
  'Access-Control-Allow-Origin': '*',
}
