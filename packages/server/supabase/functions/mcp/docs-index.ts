/** Deno copy of packages/mcp/src/docs-index.ts — keep in sync. */

export interface DocIndexEntry {
  title: string
  path: string
  keywords: string[]
  excerpt: string
}

const BASE = 'https://kensaur.us/mushi-mushi/docs'

function docPath(suffix: string): string {
  return BASE + suffix
}

export const MUSHI_DOCS_INDEX: DocIndexEntry[] = [
  {
    title: 'Architecture overview',
    path: docPath('/concepts/architecture'),
    keywords: ['architecture', 'evolution loop', 'pdca', 'overview'],
    excerpt: 'How Mushi captures user-felt bugs, triages, dispatches fixes, and learns.',
  },
  {
    title: 'MCP setup',
    path: docPath('/guides/mcp-setup'),
    keywords: ['mcp', 'cursor', 'api key', 'stdio', 'http', 'multi-project', 'account mode', 'install', 'setup', 'deeplink'],
    excerpt: 'Wire Mushi MCP into Cursor, Claude, or any MCP client. Supports per-project and account-level keys.',
  },
  {
    title: 'API key scopes',
    path: docPath('/guides/api-keys'),
    keywords: ['api key', 'mcp:read', 'mcp:write', 'scopes', 'security', 'account key', 'org-scoped', 'multi-project'],
    excerpt: 'Separate SDK ingest keys from MCP read/write keys. Mint an org-scoped account key for multi-project access.',
  },
  {
    title: 'Account key (org-scoped)',
    path: docPath('/guides/mcp-setup'),
    keywords: ['account key', 'org-scoped', 'multi-project', 'MUSHI_PROJECT_ID', 'all projects', 'mint-org-key', 'get_account_overview'],
    excerpt: 'Mint one org-scoped key that covers all your projects — no MUSHI_PROJECT_ID needed. The agent calls get_account_overview to discover projects.',
  },
  {
    title: 'Cursor MCP troubleshooting',
    path: docPath('/guides/mcp-setup'),
    keywords: ['cursor', 'mcp.json', 'red badge', 'transport error', 'stdout', 'stderr', 'json-rpc', 'INVALID_TOKEN', 'syntax helper', 'diagnose_connection'],
    excerpt: 'Cursor stdio MCP requires stdout to contain only JSON-RPC. Use the console syntax helper, restart Cursor MCP, then run diagnose_connection.',
  },
  {
    title: 'Judge loop',
    path: docPath('/concepts/judge-loop'),
    keywords: ['judge', 'sonnet', 'quality', 'fix scoring'],
    excerpt: 'Sonnet-as-Judge scores fix quality and feeds the lesson library.',
  },
  {
    title: 'Inventory v2',
    path: docPath('/concepts/inventory'),
    keywords: ['inventory', 'user stories', 'spec', 'yaml', 'actions'],
    excerpt: 'inventory.yaml maps pages, stories, and expected outcomes for spec traceability.',
  },
  {
    title: 'QA coverage stories',
    path: docPath('/guides/qa-stories'),
    keywords: ['qa', 'playwright', 'tdd', 'cron', 'browserbase', 'firecrawl'],
    excerpt: 'Author, approve, and schedule user-story tests.',
  },
  {
    title: 'Skill pipelines',
    path: docPath('/guides/skill-pipelines'),
    keywords: ['skills', 'pipeline', 'cursor', 'workflow'],
    excerpt: 'Attach agent skills to reports and run handoff or cloud pipelines.',
  },
  {
    title: 'Dispatch fix',
    path: docPath('/guides/dispatch-fix'),
    keywords: ['dispatch', 'fix', 'pr', 'cursor cloud', 'autofix'],
    excerpt: 'Dispatch the Mushi fix agent or Cursor Cloud for a classified report.',
  },
  {
    title: 'SDK installation',
    path: docPath('/guides/sdk'),
    keywords: ['sdk', 'install', 'react', 'next', 'ingest'],
    excerpt: 'Install @mushi-mushi/web and start capturing user reports.',
  },
  {
    title: 'Configuration reference',
    path: docPath('/reference/config'),
    keywords: ['env', 'config', 'settings', 'byok'],
    excerpt: 'Environment variables and project settings reference.',
  },
  {
    title: 'Evolution loop',
    path: docPath('/concepts/evolution'),
    keywords: ['evolution', 'lessons', 'convergence', 'prompt promotion'],
    excerpt: 'Closed-loop learning from bugs, fixes, and judge scores.',
  },
  {
    title: 'Privacy & BYOK',
    path: docPath('/guides/privacy'),
    keywords: ['privacy', 'byok', 'data region', 'llm'],
    excerpt: 'Data boundaries, BYOK LLM keys, and retention.',
  },
]

export function searchMushiDocs(query: string, limit = 8): Array<DocIndexEntry & { score: number }> {
  const q = query.trim().toLowerCase()
  if (!q) {
    return MUSHI_DOCS_INDEX.slice(0, limit).map((e) => ({ ...e, score: 0 }))
  }
  const terms = q.split(/\s+/).filter(Boolean)
  const scored = MUSHI_DOCS_INDEX.map((entry) => {
    const hay = (entry.title + ' ' + entry.keywords.join(' ') + ' ' + entry.excerpt).toLowerCase()
    let score = 0
    for (const term of terms) {
      if (entry.title.toLowerCase().includes(term)) score += 4
      if (entry.keywords.some((k) => k.includes(term))) score += 3
      if (hay.includes(term)) score += 1
    }
    return { ...entry, score }
  })
    .filter((e) => e.score > 0)
    .sort((a, b) => b.score - a.score)
  return scored.slice(0, limit)
}
