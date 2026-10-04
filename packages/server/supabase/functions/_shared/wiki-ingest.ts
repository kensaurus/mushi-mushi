/**
 * Wiki / docs knowledge ingest for /explore?tab=knowledge.
 *
 * A `project_codebase_wiki_sources` row (kind `repo_subpath`) names a folder
 * in the project's connected GitHub repo. This module reads the Markdown and
 * text files under it, splits them by heading, embeds the chunks into
 * `project_codebase_knowledge_chunks` (read by `match_knowledge_chunks` in
 * Ask), writes one article graph to `project_codebase_knowledge_graph` (the
 * "Knowledge entities" list), and moves the source to `ready` or `failed`
 * with a plain-English reason.
 *
 * Before this existed nothing processed a source: rows sat at `pending`
 * forever while the console said they had been added.
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { parseGithubRepoUrl, resolveProjectGithubToken } from './github.ts'
import { fetchRepoTreeWithBranchFallback, type RepoTree } from './github-branch.ts'
import { createEmbeddingBatch } from './embeddings.ts'
import { log } from './logger.ts'

const wikiLog = log.child('wiki-ingest')

/** File types read as knowledge. Code files belong to the code index, not here. */
const DOC_EXTENSIONS = ['.md', '.mdx', '.markdown', '.txt', '.rst', '.adoc']
export const WIKI_MAX_FILES = 150
const MAX_FILE_CHARS = 200_000
const MAX_CHUNK_CHARS = 2_000
const EMBED_BATCH = 64
const FETCH_CONCURRENCY = 6

/**
 * A source still `pending` or `indexing` after this long was never picked up
 * or its worker died (edge wall clock). The console offers Retry for it and
 * the retry route accepts it.
 */
export const WIKI_STALE_MS = 10 * 60 * 1000

export function isWikiSourceStale(
  row: { status: string; updated_at?: string | null },
  now = Date.now(),
): boolean {
  if (row.status !== 'pending' && row.status !== 'indexing') return false
  const at = row.updated_at ? Date.parse(row.updated_at) : NaN
  return Number.isFinite(at) && now - at > WIKI_STALE_MS
}

export interface WikiChunk {
  article_path: string
  chunk_index: number
  title: string | null
  body: string
}

export interface KnowledgeGraphNode {
  id: string
  type: 'article'
  name: string
  summary?: string
  path: string
}

export interface KnowledgeGraph {
  version: 1
  nodes: KnowledgeGraphNode[]
  edges: Array<{ source: string; target: string; type: 'links_to' }>
}

/** `docs`, `/docs/`, `./docs` → `docs/`; empty / `/` → repo root. */
export function normalizeWikiRoot(root: string): string {
  const trimmed = root.trim().replace(/^\.?\/+/, '').replace(/\/+$/, '')
  return trimmed ? `${trimmed}/` : ''
}

export function isWikiDocPath(path: string, root: string): boolean {
  const prefix = normalizeWikiRoot(root)
  if (prefix && !path.startsWith(prefix)) return false
  const lower = path.toLowerCase()
  return DOC_EXTENSIONS.some((ext) => lower.endsWith(ext))
}

/** Every doc file under `root` (before the cap), for the "read N of M" note. */
export function countWikiFiles(tree: RepoTree, root: string): number {
  return (tree.tree ?? []).filter((e) => e.type === 'blob' && isWikiDocPath(e.path, root) && (e.size ?? 0) <= MAX_FILE_CHARS).length
}

/** Doc files under `root` in a git tree, smallest-path-first, capped. */
export function selectWikiFiles(tree: RepoTree, root: string, max = WIKI_MAX_FILES): string[] {
  return (tree.tree ?? [])
    .filter((e) => e.type === 'blob' && isWikiDocPath(e.path, root) && (e.size ?? 0) <= MAX_FILE_CHARS)
    .map((e) => e.path)
    .sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b))
    .slice(0, max)
}

function fileTitle(path: string): string {
  const base = path.split('/').pop() ?? path
  return base.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ')
}

/**
 * Split one article by Markdown headings (`#`..`###`), then by size. Each
 * chunk carries the nearest heading as its title so Ask can cite it.
 */
export function chunkWikiArticle(path: string, text: string, maxChars = MAX_CHUNK_CHARS): WikiChunk[] {
  const sections: Array<{ title: string | null; lines: string[] }> = [{ title: null, lines: [] }]
  let inFence = false
  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence
    const heading = !inFence ? /^(#{1,3})\s+(.+?)\s*#*\s*$/.exec(line) : null
    if (heading) {
      sections.push({ title: heading[2]!.trim(), lines: [] })
    } else {
      sections[sections.length - 1]!.lines.push(line)
    }
  }

  const chunks: WikiChunk[] = []
  for (const section of sections) {
    const body = section.lines.join('\n').trim()
    if (!body && !section.title) continue
    const full = section.title ? `${section.title}\n\n${body}`.trim() : body
    for (let i = 0; i < full.length; i += maxChars) {
      chunks.push({
        article_path: path,
        chunk_index: chunks.length,
        title: section.title ?? fileTitle(path),
        body: full.slice(i, i + maxChars),
      })
    }
  }
  return chunks
}

function firstParagraph(text: string): string | undefined {
  const para = text
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .find((p) => p && !p.startsWith('#') && !p.startsWith('```') && !p.startsWith('---'))
  return para ? para.replace(/\s+/g, ' ').slice(0, 240) : undefined
}

function resolveRelative(fromPath: string, href: string): string {
  const parts = fromPath.split('/').slice(0, -1)
  for (const seg of href.split('/')) {
    if (seg === '..') parts.pop()
    else if (seg && seg !== '.') parts.push(seg)
  }
  return parts.join('/')
}

/** One node per article (title from its first H1, else the file name), edges for relative doc links. */
export function buildKnowledgeGraph(articles: Array<{ path: string; text: string }>): KnowledgeGraph {
  const paths = new Set(articles.map((a) => a.path))
  const nodes: KnowledgeGraphNode[] = articles.map((a) => {
    const h1 = /^#\s+(.+?)\s*#*\s*$/m.exec(a.text)
    const summary = firstParagraph(a.text)
    return {
      id: `article:${a.path}`,
      type: 'article',
      name: h1?.[1]?.trim() || fileTitle(a.path),
      path: a.path,
      ...(summary ? { summary } : {}),
    }
  })
  const edges: KnowledgeGraph['edges'] = []
  const seen = new Set<string>()
  for (const a of articles) {
    for (const m of a.text.matchAll(/\]\(([^)\s#?]+)(?:[#?][^)]*)?\)/g)) {
      const href = m[1]!
      if (/^[a-z]+:/i.test(href) || href.startsWith('/')) continue
      const target = resolveRelative(a.path, href)
      if (!paths.has(target) || target === a.path) continue
      const key = `${a.path}->${target}`
      if (seen.has(key)) continue
      seen.add(key)
      edges.push({ source: `article:${a.path}`, target: `article:${target}`, type: 'links_to' })
    }
  }
  return { version: 1, nodes, edges }
}

export interface WikiSourceRow {
  id: string
  project_id: string
  kind: string
  root_path: string
}

export interface WikiIngestDeps {
  /** Repo + token for the project, or a plain-English reason it cannot be read. */
  resolveRepo: (projectId: string) => Promise<
    { ok: true; owner: string; repo: string; branch: string; token: string } | { ok: false; reason: string }
  >
  fetchTree: (args: { token: string; owner: string; repo: string; branch: string }) => Promise<{ tree: RepoTree; branch: string }>
  fetchFile: (args: { token: string; owner: string; repo: string; branch: string; path: string }) => Promise<string | null>
  embed: (inputs: string[], projectId: string) => Promise<number[][]>
}

async function defaultResolveRepo(db: SupabaseClient, projectId: string): ReturnType<WikiIngestDeps['resolveRepo']> {
  const { data: row, error } = await db
    .from('project_repos')
    .select('repo_url, default_branch, github_app_installation_id')
    .eq('project_id', projectId)
    .order('is_primary', { ascending: false })
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (error) return { ok: false, reason: 'Could not read the connected repo. Retry in a minute.' }
  const parsed = parseGithubRepoUrl((row?.repo_url as string | null) ?? null)
  if (!row || !parsed) {
    return { ok: false, reason: 'No GitHub repo is connected to this project. Connect one on the Connect page, then retry.' }
  }
  // No platform-token fallback: knowledge text is shown back in Ask answers,
  // so a project must read GitHub with its own credential.
  const token = await resolveProjectGithubToken(
    db as never,
    projectId,
    (row.github_app_installation_id as number | null) ?? null,
    { allowEnvFallback: false },
  )
  if (!token) {
    return { ok: false, reason: 'GitHub is not connected for this project. Add access on the Connect page, then retry.' }
  }
  return { ok: true, owner: parsed.owner, repo: parsed.repo, branch: (row.default_branch as string | null) || 'main', token }
}

export function defaultWikiIngestDeps(db: SupabaseClient): WikiIngestDeps {
  return {
    resolveRepo: (projectId) => defaultResolveRepo(db, projectId),
    fetchTree: async (args) => {
      const got = await fetchRepoTreeWithBranchFallback(args)
      return { tree: got.tree, branch: got.branch }
    },
    fetchFile: async ({ token, owner, repo, branch, path }) => {
      const encoded = path.split('/').filter(Boolean).map(encodeURIComponent).join('/')
      const res = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/contents/${encoded}?ref=${encodeURIComponent(branch)}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github.raw',
            'X-GitHub-Api-Version': '2022-11-28',
          },
          signal: AbortSignal.timeout(15_000),
        },
      )
      if (!res.ok) return null
      const text = await res.text()
      return text.length > 0 && text.length <= MAX_FILE_CHARS ? text : null
    },
    embed: (inputs, projectId) => createEmbeddingBatch(inputs, { projectId }),
  }
}

/** A thrown error → the sentence stored on the source row and shown in the console. */
export function wikiIngestFailureReason(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  if (/OPENAI_API_KEY|no BYOK key/i.test(msg)) {
    return 'No OpenAI key is available to embed the docs. Add one under Settings → API keys, then retry.'
  }
  if (/tree fetch 404|not accessible/i.test(msg)) {
    return 'GitHub could not find the repo or branch with this project’s access. Check the connected repo, then retry.'
  }
  if (/tree fetch 40[13]/i.test(msg)) {
    return 'GitHub refused access to the repo. Reconnect GitHub on the Connect page, then retry.'
  }
  return 'Reading the docs failed. Retry in a minute; if it keeps failing, report it from the help menu.'
}

export interface WikiIngestResult {
  /** skipped = another job already claimed this source. */
  status: 'ready' | 'failed' | 'skipped'
  articles: number
  chunks: number
  error?: string
}

async function setStatus(db: SupabaseClient, id: string, status: string, error: string | null) {
  const { error: writeErr } = await db
    .from('project_codebase_wiki_sources')
    .update({ status, error, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (writeErr) throw new Error(`wiki source status write failed: ${writeErr.message}`)
}

/** Ingest one source end to end. Never throws for an expected failure; the row says why. */
export async function ingestWikiSource(
  db: SupabaseClient,
  source: WikiSourceRow,
  deps: WikiIngestDeps = defaultWikiIngestDeps(db),
): Promise<WikiIngestResult> {
  const fail = async (reason: string): Promise<WikiIngestResult> => {
    await setStatus(db, source.id, 'failed', reason)
    return { status: 'failed', articles: 0, chunks: 0, error: reason }
  }

  if (source.kind !== 'repo_subpath') {
    return fail('Only folders in the connected repo can be added as knowledge right now.')
  }

  // Claim the row: two quick adds start two jobs that read the same pending
  // rows, and only one of them may ingest each source.
  const { data: claimed, error: claimErr } = await db
    .from('project_codebase_wiki_sources')
    .update({ status: 'indexing', error: null, updated_at: new Date().toISOString() })
    .eq('id', source.id)
    .eq('status', 'pending')
    .select('id')
  if (claimErr) throw new Error(`wiki source claim failed: ${claimErr.message}`)
  if (!claimed || claimed.length === 0) return { status: 'skipped', articles: 0, chunks: 0 }

  try {
    const repo = await deps.resolveRepo(source.project_id)
    if (!repo.ok) return await fail(repo.reason)

    const { tree, branch } = await deps.fetchTree(repo)
    const paths = selectWikiFiles(tree, source.root_path)
    if (paths.length === 0) {
      const where = normalizeWikiRoot(source.root_path) || 'the repo root'
      return await fail(`No Markdown or text files were found under ${where} on ${branch}. Check the folder name, then retry.`)
    }

    const found = countWikiFiles(tree, source.root_path)
    const texts: Array<string | null> = new Array(paths.length).fill(null)
    let next = 0
    const worker = async () => {
      while (next < paths.length) {
        const i = next++
        texts[i] = await deps.fetchFile({ ...repo, branch, path: paths[i]! })
      }
    }
    await Promise.all(Array.from({ length: Math.min(FETCH_CONCURRENCY, paths.length) }, worker))
    const articles = paths
      .map((path, i) => ({ path, text: texts[i] }))
      .filter((a): a is { path: string; text: string } => !!a.text)
    if (articles.length === 0) {
      return await fail('The docs folder was found but none of its files could be read. Retry in a minute.')
    }

    const chunks = articles.flatMap((a) => chunkWikiArticle(a.path, a.text))
    const rows: Array<WikiChunk & { embedding: number[] }> = []
    for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
      const batch = chunks.slice(i, i + EMBED_BATCH)
      const vectors = await deps.embed(batch.map((c) => `${c.article_path}::${c.title ?? ''}\n${c.body}`), source.project_id)
      batch.forEach((c, j) => rows.push({ ...c, embedding: vectors[j]! }))
    }

    // Replace, not merge: a file removed from the folder must stop answering.
    const { error: delErr } = await db.from('project_codebase_knowledge_chunks').delete().eq('source_id', source.id)
    if (delErr) throw new Error(`knowledge chunk cleanup failed: ${delErr.message}`)
    const now = new Date().toISOString()
    for (let i = 0; i < rows.length; i += 200) {
      const { error } = await db.from('project_codebase_knowledge_chunks').insert(
        rows.slice(i, i + 200).map((r) => ({
          project_id: source.project_id,
          source_id: source.id,
          article_path: r.article_path,
          chunk_index: r.chunk_index,
          title: r.title,
          body: r.body,
          embedding: r.embedding,
          updated_at: now,
        })),
      )
      if (error) throw new Error(`knowledge chunk write failed: ${error.message}`)
    }

    const graph = buildKnowledgeGraph(articles)
    const { error: graphErr } = await db.from('project_codebase_knowledge_graph').upsert(
      {
        project_id: source.project_id,
        source_id: source.id,
        index_fingerprint: `${branch}:${articles.length}:${rows.length}`,
        graph,
        updated_at: now,
      },
      { onConflict: 'source_id' },
    )
    if (graphErr) throw new Error(`knowledge graph write failed: ${graphErr.message}`)

    // What was actually read, so "Ready" never overstates a capped folder.
    const { error: readyErr } = await db
      .from('project_codebase_wiki_sources')
      .update({
        status: 'ready',
        error: null,
        config: { last_ingest: { files_read: articles.length, files_found: found, chunks: rows.length, branch, at: now } },
        updated_at: now,
      })
      .eq('id', source.id)
    if (readyErr) throw new Error(`wiki source status write failed: ${readyErr.message}`)
    return { status: 'ready', articles: articles.length, chunks: rows.length }
  } catch (err) {
    wikiLog.error('wiki ingest failed', { sourceId: source.id, err: err instanceof Error ? err.message : String(err) })
    return await fail(wikiIngestFailureReason(err))
  }
}

/**
 * The `wiki_ingest` analyze job: every pending source of the project (the one
 * just added plus any stuck from before this worker existed).
 */
export async function runWikiIngestForProject(
  db: SupabaseClient,
  projectId: string,
  deps?: WikiIngestDeps,
): Promise<{ processed: number; ready: number; failed: number }> {
  const { data, error } = await db
    .from('project_codebase_wiki_sources')
    .select('id, project_id, kind, root_path')
    .eq('project_id', projectId)
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(20)
  if (error) throw new Error(`wiki sources read failed: ${error.message}`)
  let ready = 0
  let failed = 0
  for (const source of (data ?? []) as WikiSourceRow[]) {
    const result = await ingestWikiSource(db, source, deps)
    if (result.status === 'ready') ready++
    else if (result.status === 'failed') failed++
  }
  return { processed: ready + failed, ready, failed }
}
