/**
 * Lightweight static index for search_mushi_docs — no runtime dependency on
 * the docs app build. Update when major docs pages ship.
 */

export interface DocIndexEntry {
  title: string
  path: string
  keywords: string[]
  excerpt: string
}

const BASE = 'https://kensaur.us/mushi-mushi/docs'

export const MUSHI_DOCS_INDEX: DocIndexEntry[] = [
  {
    title: 'Architecture overview',
    path: `${BASE}/concepts/architecture`,
    keywords: ['architecture', 'evolution loop', 'pdca', 'overview'],
    excerpt: 'How Mushi captures user-felt bugs, triages, dispatches fixes, and learns.',
  },
  {
    title: 'MCP setup',
    path: `${BASE}/guides/mcp-setup`,
    keywords: ['mcp', 'cursor', 'api key', 'stdio', 'http'],
    excerpt: 'Wire Mushi MCP into Cursor, Claude, or any MCP client.',
  },
  {
    title: 'API key scopes',
    path: `${BASE}/guides/api-keys`,
    keywords: ['api key', 'mcp:read', 'mcp:write', 'scopes', 'security'],
    excerpt: 'Separate SDK ingest keys from MCP read/write keys.',
  },
  {
    title: 'Judge loop',
    path: `${BASE}/concepts/judge-loop`,
    keywords: ['judge', 'sonnet', 'quality', 'fix scoring'],
    excerpt: 'Sonnet-as-Judge scores fix quality and feeds the lesson library.',
  },
  {
    title: 'Inventory v2',
    path: `${BASE}/concepts/inventory`,
    keywords: ['inventory', 'user stories', 'spec', 'yaml', 'actions'],
    excerpt: 'inventory.yaml maps pages, stories, and expected outcomes for spec traceability.',
  },
  {
    title: 'QA coverage stories',
    path: `${BASE}/guides/qa-stories`,
    keywords: ['qa', 'playwright', 'tdd', 'cron', 'browserbase', 'firecrawl'],
    excerpt: 'Author, approve, and schedule user-story tests.',
  },
  {
    title: 'Skill pipelines',
    path: `${BASE}/guides/skill-pipelines`,
    keywords: ['skills', 'pipeline', 'cursor', 'workflow'],
    excerpt: 'Attach agent skills to reports and run handoff or cloud pipelines.',
  },
  {
    title: 'Dispatch fix',
    path: `${BASE}/guides/dispatch-fix`,
    keywords: ['dispatch', 'fix', 'pr', 'cursor cloud', 'autofix'],
    excerpt: 'Dispatch the Mushi fix agent or Cursor Cloud for a classified report.',
  },
  {
    title: 'SDK installation',
    path: `${BASE}/guides/sdk`,
    keywords: ['sdk', 'install', 'react', 'next', 'ingest'],
    excerpt: 'Install @mushi-mushi/web and start capturing user reports.',
  },
  {
    title: 'Configuration reference',
    path: `${BASE}/reference/config`,
    keywords: ['env', 'config', 'settings', 'byok'],
    excerpt: 'Environment variables and project settings reference.',
  },
  {
    title: 'Evolution loop',
    path: `${BASE}/concepts/evolution`,
    keywords: ['evolution', 'lessons', 'convergence', 'prompt promotion'],
    excerpt: 'Closed-loop learning from bugs, fixes, and judge scores.',
  },
  {
    title: 'Privacy & BYOK',
    path: `${BASE}/guides/privacy`,
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
    const hay = `${entry.title} ${entry.keywords.join(' ')} ${entry.excerpt}`.toLowerCase()
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
