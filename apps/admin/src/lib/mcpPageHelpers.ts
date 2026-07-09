/**
 * Pure helpers + static catalog data for McpPage (snippets, validation, use-cases).
 */
import { MCP_PIN_SPEC } from '@mushi-mushi/mcp/clients'
import {
  buildHttpConfig,
  buildStdioConfig,
  projectServerName,
} from './cursorDeeplink'
import { RESOLVED_EXTERNAL_API_URL, RESOLVED_MCP_HTTP_URL } from './env'
import type { CatalogTabId, McpTabId } from '../components/mcp/types'

export const MCP_PAGE_TABS: Array<{ id: McpTabId; label: string; description: string }> = [
  {
    id: 'overview',
    label: 'Overview',
    description: 'MCP posture — key scopes, connection status, and recommended next steps for agent access.',
  },
  {
    id: 'setup',
    label: 'Setup',
    description: 'Mint a key, copy the snippet, and confirm your IDE sees all Mushi tools.',
  },
  {
    id: 'catalog',
    label: 'Catalog',
    description: 'Every tool, resource URI, and slash prompt the MCP server advertises.',
  },
  {
    id: 'examples',
    label: 'Examples',
    description: 'Real agent asks you can paste into Cursor or Claude Desktop today.',
  },
]

export const MCP_CATALOG_TABS: Array<{ id: CatalogTabId; label: string }> = [
  { id: 'tools', label: 'Tools' },
  { id: 'resources', label: 'Resources' },
  { id: 'prompts', label: 'Prompts' },
]

const MUSHI_MCP_API = RESOLVED_EXTERNAL_API_URL

export interface McpUseCase {
  title: string
  ask: string
  calls: string[]
}

export const MCP_USE_CASES: McpUseCase[] = [
  {
    title: 'Start my day',
    ask: 'What should I focus on right now?',
    calls: ['triage_next_steps', 'project://dashboard', 'get_recent_reports'],
  },
  {
    title: 'Fix a specific bug',
    ask: 'Fix rep_abc123.',
    calls: ['summarize_report_for_fix', 'get_fix_context', 'get_blast_radius', 'submit_fix_result'],
  },
  {
    title: 'Debug a failed fix',
    ask: 'Why did fix_xyz fail?',
    calls: ['get_fix_timeline', 'explain_judge_result'],
  },
  {
    title: 'Spot duplicates fast',
    ask: 'Have we seen a bug like this before in Checkout?',
    calls: ['get_similar_bugs'],
  },
  {
    title: 'Ask production data in English',
    ask: 'Which components had the most critical bugs this week?',
    calls: ['run_nl_query'],
  },
  {
    title: 'Triage across all my apps',
    ask: 'What are my most urgent bugs across all my projects?',
    calls: ['get_account_overview', 'get_recent_reports (project_id=X)', 'get_recent_reports (project_id=Y)'],
  },
  {
    title: 'New project check-in',
    ask: 'Is the SDK sending data? Any critical issues?',
    calls: ['list_projects', 'get_project_context', 'diagnose_setup'],
  },
]

export const MCP_USE_CASE_GROUPS: Array<{ label: string; tools: string[]; description: string }> = [
  {
    label: 'Start my day / triage',
    tools: ['triage_next_steps', 'get_recent_reports', 'get_account_overview', 'project://dashboard'],
    description: 'Survey the queue, understand what needs attention, check project health.',
  },
  {
    label: 'Fix a bug end-to-end',
    tools: ['summarize_report_for_fix', 'get_fix_context', 'get_blast_radius', 'submit_fix_result', 'get_fix_timeline', 'explain_judge_result'],
    description: 'Get full context on a report, dispatch a fix, track CI, and merge.',
  },
  {
    label: 'Query production data',
    tools: ['run_nl_query', 'get_similar_bugs', 'list_projects', 'get_project_context', 'diagnose_setup'],
    description: 'Query report data from your editor.',
  },
]

export function resolveMcpTab(value: string | null): McpTabId {
  if (value === 'setup' || value === 'catalog' || value === 'examples') return value
  return 'overview'
}

export function isCatalogTabId(v: string | null): v is CatalogTabId {
  return MCP_CATALOG_TABS.some((t) => t.id === v)
}

export function buildSdkInstallSnippet(pkgManager: 'npm' | 'yarn' | 'pnpm'): string {
  const cmds: Record<'npm' | 'yarn' | 'pnpm', string> = {
    npm: 'npm install @mushi-mushi/web',
    yarn: 'yarn add @mushi-mushi/web',
    pnpm: 'pnpm add @mushi-mushi/web',
  }
  return cmds[pkgManager]
}

export function buildSdkInitSnippet(projectId: string): string {
  return `import Mushi from '@mushi-mushi/web';

// Call once at app startup (e.g. in _app.tsx / main.tsx).
// Use a report:write key — NOT your MCP key.
Mushi.init({
  apiKey: 'mushi_<your-report-write-key>',
  projectId: '${projectId}',
});

// Identify users so reports are tied to real people:
Mushi.identify({ id: user.id, email: user.email });`
}

export function buildCursorJson(projectId: string, projectName: string): string {
  const serverName = projectServerName(projectId, projectName)
  return JSON.stringify(
    {
      mcpServers: {
        [serverName]: buildStdioConfig(projectId, 'paste-your-mushi-api-key-here', MUSHI_MCP_API),
      },
    },
    null,
    2,
  )
}

export function buildHttpCursorJson(projectId: string, projectName: string): string {
  const serverName = projectServerName(projectId, projectName)
  return JSON.stringify(
    {
      mcpServers: {
        [serverName]: buildHttpConfig(projectId, 'paste-your-mushi-api-key-here', RESOLVED_MCP_HTTP_URL),
      },
    },
    null,
    2,
  )
}

export function buildEnvBlock(projectId: string): string {
  return [
    '# Mushi MCP — paste into .env.local (gitignored).',
    `MUSHI_API_ENDPOINT=${MUSHI_MCP_API}`,
    'MUSHI_API_KEY=paste-your-mushi-api-key-here',
    `MUSHI_PROJECT_ID=${projectId}`,
    '# Optional: lean tool set (default in admin snippets). Omit or set to "all" for full catalog.',
    'MUSHI_FEATURES=triage,fixes,inventory,setup,docs',
    '',
  ].join('\n')
}

export interface McpJsonCheck {
  ok: boolean
  title: string
  details: string[]
}

export function validateMcpJsonSyntax(raw: string): McpJsonCheck {
  if (!raw.trim()) {
    return {
      ok: false,
      title: 'Paste an mcp.json block to check it.',
      details: ['Tip: click "Load generated snippet" below to start from the active project config.'],
    }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    return {
      ok: false,
      title: 'Invalid JSON syntax.',
      details: [err instanceof Error ? err.message : 'The config is not valid JSON.'],
    }
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, title: 'Root must be an object.', details: ['Expected { "mcpServers": { ... } }.'] }
  }

  const root = parsed as { mcpServers?: unknown }
  if (!root.mcpServers || typeof root.mcpServers !== 'object' || Array.isArray(root.mcpServers)) {
    return {
      ok: false,
      title: 'Missing mcpServers object.',
      details: ['Cursor expects { "mcpServers": { "mushi-...": { ... } } }.'],
    }
  }

  const entries = Object.entries(root.mcpServers as Record<string, unknown>)
  const mushiEntries = entries.filter(([name, value]) => {
    if (!value || typeof value !== 'object') return false
    const server = value as { command?: unknown; args?: unknown; url?: unknown; env?: unknown }
    const args = Array.isArray(server.args) ? server.args.join(' ') : ''
    const env = server.env && typeof server.env === 'object' ? server.env as Record<string, unknown> : {}
    return name.includes('mushi') ||
      String(server.command ?? '').includes('mushi') ||
      args.includes('mushi') ||
      Boolean(env.MUSHI_API_KEY || env.MUSHI_API_ENDPOINT)
  })

  if (mushiEntries.length === 0) {
    return {
      ok: false,
      title: 'No Mushi server entry found.',
      details: ['Add a server named like "mushi-my-app" or paste the generated snippet.'],
    }
  }

  const details: string[] = []
  let ok = true

  for (const [name, value] of mushiEntries) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      ok = false
      details.push(`${name}: server config must be an object.`)
      continue
    }

    const server = value as {
      type?: unknown
      command?: unknown
      args?: unknown
      env?: unknown
      url?: unknown
      headers?: unknown
    }
    const isHttp = server.type === 'http' || typeof server.url === 'string'

    if (isHttp) {
      if (typeof server.url !== 'string' || !server.url.startsWith('http')) {
        ok = false
        details.push(`${name}: hosted HTTP config needs a valid url.`)
      }
      const headers = server.headers && typeof server.headers === 'object'
        ? server.headers as Record<string, unknown>
        : {}
      if (!headers.Authorization && !headers['X-Mushi-Api-Key']) {
        ok = false
        details.push(`${name}: hosted HTTP config needs Authorization or X-Mushi-Api-Key headers.`)
      }
      continue
    }

    if (typeof server.command !== 'string') {
      ok = false
      details.push(`${name}: stdio config needs a command, usually "npx" or "node".`)
    }
    if (!Array.isArray(server.args) || server.args.some((arg) => typeof arg !== 'string')) {
      ok = false
      details.push(`${name}: stdio config needs args as a string array.`)
    }

    const env = server.env && typeof server.env === 'object'
      ? server.env as Record<string, unknown>
      : null
    if (!env) {
      ok = false
      details.push(`${name}: stdio config needs an env object with MUSHI_* values.`)
      continue
    }
    if (typeof env.MUSHI_API_ENDPOINT !== 'string' || !env.MUSHI_API_ENDPOINT.includes('/functions/v1/api')) {
      ok = false
      details.push(`${name}: MUSHI_API_ENDPOINT should end with /functions/v1/api.`)
    }
    if (typeof env.MUSHI_API_KEY !== 'string' || !env.MUSHI_API_KEY.startsWith('mushi_')) {
      ok = false
      details.push(`${name}: MUSHI_API_KEY should start with mushi_.`)
    }
    if (!env.MUSHI_PROJECT_ID) {
      details.push(`${name}: no MUSHI_PROJECT_ID means account mode; use an org-scoped key or pass project_id in tool calls.`)
    }
    if (Array.isArray(server.args) && server.args.includes('@mushi-mushi/mcp@latest')) {
      details.push(`${name}: uses npm @latest — re-pin it (run "npx mushi-mushi setup" or replace with ${MCP_PIN_SPEC}) to avoid supply-chain and cold-start surprises.`)
    }
  }

  return {
    ok,
    title: ok ? 'Syntax looks valid.' : 'Config needs changes.',
    details: details.length > 0 ? details : ['Restart Cursor MCP after saving the file, then run diagnose_setup.'],
  }
}
