/**
 * `_shared/wiki-ingest.ts` — the knowledge-source ingest behind
 * /explore?tab=knowledge "Add source".
 *
 * Regression (P0): nothing processed a source. Rows stayed `pending` forever,
 * no chunk or graph row was ever written, and the panel said "Add source"
 * worked. These tests drive a source from `pending` to `ready` (chunks and
 * graph written) and to `failed` with a plain-English reason.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { makeFakeDb } from './__stubs__/fake-supabase.ts'

vi.mock('../../supabase/functions/_shared/github.ts', () => ({
  parseGithubRepoUrl: () => null,
  resolveProjectGithubToken: async () => null,
}))
vi.mock('../../supabase/functions/_shared/github-branch.ts', () => ({
  fetchRepoTreeWithBranchFallback: async () => {
    throw new Error('real tree fetch must not run in tests')
  },
}))
vi.mock('../../supabase/functions/_shared/embeddings.ts', () => ({
  createEmbeddingBatch: async () => {
    throw new Error('real embeddings must not run in tests')
  },
}))

type Mod = typeof import('../../supabase/functions/_shared/wiki-ingest.ts')
let wiki: Mod

beforeAll(async () => {
  ;(globalThis as { Deno?: unknown }).Deno = { env: { get: (k: string) => process.env[k] } }
  wiki = await import('../../supabase/functions/_shared/wiki-ingest.ts')
})

const FILES: Record<string, string> = {
  'docs/index.md': '# Handbook\n\nHow we build things.\n\nSee [auth](./auth.md).\n\n## Setup\n\nRun pnpm install.',
  'docs/auth.md': '# Auth\n\nSessions use Supabase.\n',
  'docs/img.png': 'binary',
  'src/app.ts': 'export const x = 1',
}

function deps(overrides: Partial<import('../../supabase/functions/_shared/wiki-ingest.ts').WikiIngestDeps> = {}) {
  return {
    resolveRepo: async () => ({ ok: true as const, owner: 'o', repo: 'r', branch: 'main', token: 't' }),
    fetchTree: async () => ({
      branch: 'main',
      tree: { tree: Object.keys(FILES).map((path) => ({ path, type: 'blob', size: FILES[path]!.length })) },
    }),
    fetchFile: async ({ path }: { path: string }) => FILES[path] ?? null,
    embed: async (inputs: string[]) => inputs.map(() => [0.1, 0.2]),
    ...overrides,
  }
}

function seed() {
  return makeFakeDb({
    project_codebase_wiki_sources: [
      { id: 's1', project_id: 'p1', kind: 'repo_subpath', root_path: 'docs/', status: 'pending', error: null },
    ],
    project_codebase_knowledge_chunks: [],
    project_codebase_knowledge_graph: [],
  })
}

describe('isWikiSourceStale', () => {
  const now = Date.parse('2026-10-04T12:00:00Z')
  it('flags pending or indexing rows untouched for over 10 minutes', () => {
    expect(wiki.isWikiSourceStale({ status: 'pending', updated_at: '2026-10-04T11:40:00Z' }, now)).toBe(true)
    expect(wiki.isWikiSourceStale({ status: 'indexing', updated_at: '2026-10-04T11:40:00Z' }, now)).toBe(true)
  })
  it('leaves fresh and finished rows alone', () => {
    expect(wiki.isWikiSourceStale({ status: 'indexing', updated_at: '2026-10-04T11:58:00Z' }, now)).toBe(false)
    expect(wiki.isWikiSourceStale({ status: 'failed', updated_at: '2026-10-01T00:00:00Z' }, now)).toBe(false)
  })
})

describe('pure helpers', () => {
  it('normalizes the folder the user typed', () => {
    expect(wiki.normalizeWikiRoot('docs')).toBe('docs/')
    expect(wiki.normalizeWikiRoot('./docs/')).toBe('docs/')
    expect(wiki.normalizeWikiRoot('/')).toBe('')
  })

  it('keeps only doc files under the folder', () => {
    expect(wiki.isWikiDocPath('docs/a.md', 'docs')).toBe(true)
    expect(wiki.isWikiDocPath('docs/a.ts', 'docs')).toBe(false)
    expect(wiki.isWikiDocPath('documents/a.md', 'docs')).toBe(false)
  })

  it('splits an article by heading and keeps code fences intact', () => {
    const chunks = wiki.chunkWikiArticle('docs/a.md', '# A\n\nintro\n\n```\n# not a heading\n```\n\n## B\n\nbody')
    expect(chunks.map((c) => c.title)).toEqual(['A', 'B'])
    expect(chunks[0]!.body).toContain('# not a heading')
  })

  it('links articles that reference each other', () => {
    const graph = wiki.buildKnowledgeGraph([
      { path: 'docs/index.md', text: FILES['docs/index.md']! },
      { path: 'docs/auth.md', text: FILES['docs/auth.md']! },
    ])
    expect(graph.nodes.map((n) => n.name)).toEqual(['Handbook', 'Auth'])
    expect(graph.nodes[0]!.summary).toBe('How we build things.')
    expect(graph.edges).toEqual([{ source: 'article:docs/index.md', target: 'article:docs/auth.md', type: 'links_to' }])
  })
})

describe('runWikiIngestForProject', () => {
  it('moves a pending source to ready and writes chunks + graph', async () => {
    const db = seed()
    const result = await wiki.runWikiIngestForProject(db as never, 'p1', deps())
    expect(result).toEqual({ processed: 1, ready: 1, failed: 0 })
    expect(db.table('project_codebase_wiki_sources')[0]).toMatchObject({ status: 'ready', error: null })
    const chunks = db.table('project_codebase_knowledge_chunks')
    expect(chunks.length).toBeGreaterThan(0)
    expect(new Set(chunks.map((c) => c.article_path))).toEqual(new Set(['docs/index.md', 'docs/auth.md']))
    expect(chunks.every((c) => Array.isArray(c.embedding))).toBe(true)
    const graph = db.table('project_codebase_knowledge_graph')[0]!.graph as { nodes: unknown[] }
    expect(graph.nodes).toHaveLength(2)
    // Records what was read, so a capped folder never reads as complete.
    expect(db.table('project_codebase_wiki_sources')[0]!.config).toMatchObject({
      last_ingest: { files_read: 2, files_found: 2, branch: 'main' },
    })
  })

  it('skips a source another job already claimed', async () => {
    const db = seed()
    db.table('project_codebase_wiki_sources')[0]!.status = 'indexing'
    const source = { id: 's1', project_id: 'p1', kind: 'repo_subpath', root_path: 'docs/' }
    const result = await wiki.ingestWikiSource(db as never, source, deps())
    expect(result.status).toBe('skipped')
    expect(db.table('project_codebase_knowledge_chunks')).toHaveLength(0)
  })

  it('re-ingest replaces old chunks instead of duplicating them', async () => {
    const db = seed()
    await wiki.runWikiIngestForProject(db as never, 'p1', deps())
    const first = db.table('project_codebase_knowledge_chunks').length
    db.table('project_codebase_wiki_sources')[0]!.status = 'pending'
    await wiki.runWikiIngestForProject(db as never, 'p1', deps())
    expect(db.table('project_codebase_knowledge_chunks').length).toBe(first)
  })

  it('fails with a plain reason when no repo is connected', async () => {
    const db = seed()
    await wiki.runWikiIngestForProject(
      db as never,
      'p1',
      deps({ resolveRepo: async () => ({ ok: false as const, reason: 'No GitHub repo is connected to this project.' }) }),
    )
    expect(db.table('project_codebase_wiki_sources')[0]).toMatchObject({
      status: 'failed',
      error: 'No GitHub repo is connected to this project.',
    })
  })

  it('fails with a plain reason when the folder has no docs', async () => {
    const db = seed()
    db.table('project_codebase_wiki_sources')[0]!.root_path = 'wiki/'
    await wiki.runWikiIngestForProject(db as never, 'p1', deps())
    const row = db.table('project_codebase_wiki_sources')[0]!
    expect(row.status).toBe('failed')
    expect(row.error).toMatch(/No Markdown or text files were found under wiki\//)
  })

  it('names the missing embedding key instead of a raw error', async () => {
    const db = seed()
    await wiki.runWikiIngestForProject(
      db as never,
      'p1',
      deps({
        embed: async () => {
          throw new Error('OPENAI_API_KEY not set (and no BYOK key configured)')
        },
      }),
    )
    const row = db.table('project_codebase_wiki_sources')[0]!
    expect(row.status).toBe('failed')
    expect(row.error).toMatch(/No OpenAI key/)
    expect(db.table('project_codebase_knowledge_chunks')).toHaveLength(0)
  })

  it('ignores sources that are not pending', async () => {
    const db = seed()
    db.table('project_codebase_wiki_sources')[0]!.status = 'ready'
    expect(await wiki.runWikiIngestForProject(db as never, 'p1', deps())).toEqual({ processed: 0, ready: 0, failed: 0 })
  })
})
