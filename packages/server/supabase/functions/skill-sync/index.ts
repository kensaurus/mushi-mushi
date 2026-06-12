/**
 * skill-sync — Syncs SKILL.md files from allowlisted GitHub repos into
 * the agent_skills catalog. Runs on cron daily and on manual trigger.
 *
 * Auth:    requireServiceRoleAuth (internal only — cron + api/routes/skills.ts trigger)
 * Trigger: pg_cron daily + POST /v1/admin/skills/sources/:id/sync
 *
 * What it does:
 *   1. For each enabled skill_source row (optionally scoped to one source_id):
 *      a. Fetch the GitHub API repo tree at the configured ref.
 *      b. Find all skills/<name>/SKILL.md paths.
 *      c. Fetch each file, parse YAML frontmatter (name/description/license).
 *      d. Compute SHA-256 content hash; skip if unchanged.
 *      e. Parse chain_slugs from workflow bundle bodies (Read ~/.cursor/skills/<x>/SKILL.md lines).
 *      f. Embed the description via OpenAI text-embedding-3-small.
 *      g. Upsert into agent_skills.
 *   2. Update skill_sources.last_synced_at / last_synced_count / last_sync_error.
 *   3. Log to pipeline_runs for observability.
 *
 * Security:
 *   - GitHub fetches use GITHUB_TOKEN env var (read-only PAT, optional).
 *   - Only allowlisted repo slugs from skill_sources are ever fetched.
 *   - No user-supplied URLs — all fetches are from trusted GitHub API.
 *   - Secret-pattern scan before embedding/storing skill body.
 */

import { getServiceClient } from '../_shared/db.ts'
import { log as rootLog } from '../_shared/logger.ts'
import { withSentry } from '../_shared/sentry.ts'
import { requireServiceRoleAuth } from '../_shared/auth.ts'
import { createEmbedding } from '../_shared/embeddings.ts'

declare const Deno: {
  serve(handler: (req: Request) => Response | Promise<Response>): void
  env: { get(name: string): string | undefined }
}

const log = rootLog.child('skill-sync')

// ── Types ────────────────────────────────────────────────────────────────────

interface SkillFrontmatter {
  name: string
  description: string
  license?: string
  compatibility?: string
}

interface ParsedSkill {
  slug: string
  category: string
  frontmatter: SkillFrontmatter
  body: string
  chainSlugs: string[]
  contentHash: string
}

interface SkillSource {
  id: string
  project_id: string
  repo_slug: string
  ref: string
  enabled: boolean
}

// ── Secret-pattern guard (mirrors pdca-runner) ────────────────────────────────
const SECRET_PATTERNS = [
  /sk-[A-Za-z0-9]{20,}/,         // OpenAI / Anthropic keys
  /(?:AKIA|ASIA)[A-Z0-9]{16}/,   // AWS access key IDs
  /ghp_[A-Za-z0-9]{36}/,         // GitHub personal access tokens
  /crsr_[A-Za-z0-9]{32,}/,       // Cursor API keys
  /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/, // PEM private keys
]

function containsSecretPattern(text: string): boolean {
  return SECRET_PATTERNS.some((re) => re.test(text))
}

// ── YAML frontmatter parser ───────────────────────────────────────────────────
// Parses key: value pairs and YAML block scalars (> >- | |-).
// The Agent Skills spec requires only name + description in frontmatter.
function parseFrontmatter(raw: string): { frontmatter: Record<string, string>; body: string } | null {
  const trimmed = raw.trimStart()
  if (!trimmed.startsWith('---')) return null

  const endIdx = trimmed.indexOf('\n---', 3)
  if (endIdx === -1) return null

  const fmBlock = trimmed.slice(4, endIdx)
  const body = trimmed.slice(endIdx + 4).trimStart()

  const frontmatter: Record<string, string> = {}
  const lines = fmBlock.split('\n')
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const colonIdx = line.indexOf(':')
    if (colonIdx === -1) { i++; continue }

    const key = line.slice(0, colonIdx).trim()
    const rawVal = line.slice(colonIdx + 1).trim()

    // Handle YAML block scalars: > >- | |- (fold/literal multi-line values)
    if (rawVal === '>' || rawVal === '>-' || rawVal === '|' || rawVal === '|-') {
      const parts: string[] = []
      i++
      while (i < lines.length && (lines[i].startsWith(' ') || lines[i].startsWith('\t'))) {
        parts.push(lines[i].trim())
        i++
      }
      // Fold-style (>) joins non-empty lines with a space; blank lines become paragraph breaks
      if (key) frontmatter[key] = parts.filter(p => p !== '').join(' ')
    } else {
      const val = rawVal.replace(/^["']|["']$/g, '')
      if (key) frontmatter[key] = val
      i++
    }
  }

  return { frontmatter, body }
}

// ── Category from slug prefix ─────────────────────────────────────────────────
function categoryFromSlug(slug: string): string {
  const dash = slug.indexOf('-')
  if (dash === -1) return 'other'
  const prefix = slug.slice(0, dash)
  const known = ['workflow', 'debug', 'test', 'audit', 'enhance', 'backend',
                 'design', 'deploy', 'data', 'mobile', 'docs', 'meta', 'mushi',
                 'protocol', 'iterate']
  return known.includes(prefix) ? prefix : 'other'
}

// ── Chain slug parser ─────────────────────────────────────────────────────────
// Finds lines like: > Read `~/.cursor/skills/<slug>/SKILL.md` and follow it.
// Also catches: Read skill/<slug>/SKILL.md, skills/<slug>/SKILL.md
const CHAIN_RE = /(?:skills?|~\/\.cursor\/skills?)\/([a-z][a-z0-9-]{1,63})\/SKILL\.md/g

function parseChainSlugs(body: string): string[] {
  const slugs: string[] = []
  for (const m of body.matchAll(CHAIN_RE)) {
    const slug = m[1]
    if (slug && !slugs.includes(slug)) slugs.push(slug)
  }
  return slugs
}

// ── SHA-256 content hash ──────────────────────────────────────────────────────
async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

// ── GitHub API helpers ────────────────────────────────────────────────────────
function githubHeaders(): Record<string, string> {
  const token = Deno.env.get('GITHUB_TOKEN')
  const h: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'mushi-skill-sync/1.0',
  }
  if (token) h['Authorization'] = `Bearer ${token}`
  return h
}

interface GitHubTreeItem {
  path: string
  type: 'blob' | 'tree'
  sha: string
  url: string
}

async function fetchRepoTree(repoSlug: string, ref: string): Promise<GitHubTreeItem[]> {
  const url = `https://api.github.com/repos/${repoSlug}/git/trees/${ref}?recursive=1`
  const res = await fetch(url, { headers: githubHeaders() })
  if (!res.ok) {
    const msg = await res.text().catch(() => String(res.status))
    throw new Error(`GitHub tree fetch failed for ${repoSlug}@${ref}: ${res.status} — ${msg.slice(0, 200)}`)
  }
  const data = (await res.json()) as { tree?: GitHubTreeItem[]; truncated?: boolean }
  if (data.truncated) {
    log.warn('GitHub tree response truncated — large repo, may miss some skills', { repoSlug })
  }
  return data.tree ?? []
}

async function fetchBlobContent(repoSlug: string, sha: string): Promise<string> {
  const url = `https://api.github.com/repos/${repoSlug}/git/blobs/${sha}`
  const res = await fetch(url, { headers: githubHeaders() })
  if (!res.ok) {
    const remaining = res.headers.get('X-RateLimit-Remaining')
    const msg = await res.text().catch(() => String(res.status))
    const rateHint = res.status === 403 && remaining === '0'
      ? ' — GitHub rate limit exceeded; set GITHUB_TOKEN on the edge function'
      : ''
    throw new Error(`GitHub blob fetch failed ${repoSlug}@${sha.slice(0, 8)}: ${res.status}${rateHint} — ${msg.slice(0, 120)}`)
  }
  const data = (await res.json()) as { content?: string; encoding?: string }
  if (data.encoding !== 'base64' || !data.content) {
    throw new Error(`Unexpected blob encoding for ${sha}: ${data.encoding}`)
  }
  return atob(data.content.replace(/\n/g, ''))
}

async function fetchFileContent(repoSlug: string, ref: string, path: string, blobSha?: string): Promise<string> {
  if (blobSha) return fetchBlobContent(repoSlug, blobSha)
  const url = `https://api.github.com/repos/${repoSlug}/contents/${path}?ref=${ref}`
  const res = await fetch(url, { headers: githubHeaders() })
  if (!res.ok) {
    const remaining = res.headers.get('X-RateLimit-Remaining')
    const msg = await res.text().catch(() => String(res.status))
    const rateHint = res.status === 403 && remaining === '0'
      ? ' — GitHub rate limit exceeded; set GITHUB_TOKEN on the edge function'
      : ''
    throw new Error(`GitHub file fetch failed ${repoSlug}/${path}@${ref}: ${res.status}${rateHint} — ${msg.slice(0, 120)}`)
  }
  const data = (await res.json()) as { content?: string; encoding?: string }
  if (data.encoding !== 'base64' || !data.content) {
    throw new Error(`Unexpected encoding for ${path}: ${data.encoding}`)
  }
  return atob(data.content.replace(/\n/g, ''))
}

// ── Parse a single SKILL.md file ──────────────────────────────────────────────
async function parseSkillFile(
  repoSlug: string,
  ref: string,
  path: string,
  blobSha?: string,
): Promise<ParsedSkill | null> {
  // Extract slug from path: skills/<slug>/SKILL.md or skills-cursor/<slug>/SKILL.md
  const pathParts = path.split('/')
  if (pathParts.length < 3) return null
  const slug = pathParts[pathParts.length - 2]
  if (!slug || slug.length > 64) return null

  let rawContent: string
  try {
    rawContent = await fetchFileContent(repoSlug, ref, path, blobSha)
  } catch (err) {
    log.warn('Failed to fetch SKILL.md — skipping', { path, err: String(err) })
    return null
  }

  // Security: skip files containing secret patterns
  if (containsSecretPattern(rawContent)) {
    log.warn('SKILL.md contains potential secret — skipping', { path })
    return null
  }

  const parsed = parseFrontmatter(rawContent)
  if (!parsed) {
    log.warn('No frontmatter found — skipping', { path })
    return null
  }

  const { frontmatter, body } = parsed

  // Validate required fields per Agent Skills spec
  if (!frontmatter.name || !frontmatter.description) {
    log.warn('Missing required frontmatter fields — skipping', { path, name: frontmatter.name })
    return null
  }

  // Enforce slug consistency: name in frontmatter must match directory name
  // (per spec). We use the directory slug as canonical if they differ.
  const canonicalSlug = slug

  // Enforce description length (≤ 1024 chars per spec)
  const description = frontmatter.description.slice(0, 1024)

  const contentHash = await sha256(rawContent)
  const chainSlugs = parseChainSlugs(body)

  return {
    slug: canonicalSlug,
    category: categoryFromSlug(canonicalSlug),
    frontmatter: {
      name: frontmatter.name,
      description,
      license: frontmatter.license,
      compatibility: frontmatter.compatibility,
    },
    body,
    chainSlugs,
    contentHash,
  }
}

// ── Sync one source ───────────────────────────────────────────────────────────
async function syncSource(
  db: ReturnType<typeof getServiceClient>,
  source: SkillSource,
  force = false,
): Promise<{ synced: number; skipped: number; errors: number }> {
  const slog = log.child('source', { sourceId: source.id, repo: source.repo_slug, ref: source.ref })
  slog.info('Starting sync')

  const stats = { synced: 0, skipped: 0, errors: 0 }

  // Fetch tree
  let tree: GitHubTreeItem[]
  try {
    tree = await fetchRepoTree(source.repo_slug, source.ref)
  } catch (err) {
    slog.error('Failed to fetch repo tree', { err: String(err) })
    throw err
  }

  // Find SKILL.md files — support both flat (skills/<slug>/SKILL.md) and
  // nested catalog layouts (skills/<category>/<slug>/SKILL.md).
  const skillItems = tree.filter(
    (item) =>
      item.type === 'blob' &&
      item.path.endsWith('/SKILL.md') &&
      (item.path.startsWith('skills/') || item.path.startsWith('skills-cursor/')),
  )

  slog.info('Found SKILL.md files', { count: skillItems.length, hasGithubToken: Boolean(Deno.env.get('GITHUB_TOKEN')) })

  // Fetch existing content hashes for change detection
  const { data: existingSkills } = await db
    .from('agent_skills')
    .select('id, slug, content_hash')
    .eq('source_id', source.id)

  const existingBySlug = new Map(
    (existingSkills ?? []).map((s) => [s.slug as string, { id: s.id as string, hash: s.content_hash as string }]),
  )

  // Resolve BYOK key for embeddings (uses project's OpenAI key if configured)
  const openaiKey = Deno.env.get('OPENAI_API_KEY') ?? ''

  // Process each SKILL.md (use tree blob SHA to avoid extra contents API round-trips)
  for (const item of skillItems) {
    const path = item.path
    try {
      const skill = await parseSkillFile(source.repo_slug, source.ref, path, item.sha)
      if (!skill) {
        stats.skipped++
        continue
      }

      const existing = existingBySlug.get(skill.slug)
      if (!force && existing?.hash === skill.contentHash) {
        slog.debug('No change — skipping', { slug: skill.slug })
        stats.skipped++
        continue
      }

      // Generate embedding for description
      let embedding: number[] | null = null
      if (openaiKey) {
        try {
          embedding = await createEmbedding(skill.frontmatter.description, { projectId: source.project_id })
        } catch (embErr) {
          slog.warn('Embedding failed — storing without vector', { slug: skill.slug, err: String(embErr) })
        }
      }

      // Upsert
      const upsertData: Record<string, unknown> = {
        source_id: source.id,
        slug: skill.slug,
        category: skill.category,
        title: skill.frontmatter.name || skill.slug,
        description: skill.frontmatter.description,
        license: skill.frontmatter.license ?? null,
        compatibility: skill.frontmatter.compatibility ?? null,
        body_md: skill.body,
        chain_slugs: skill.chainSlugs,
        content_hash: skill.contentHash,
        is_active: true,
        updated_at: new Date().toISOString(),
      }
      if (embedding) upsertData.description_embedding = JSON.stringify(embedding)

      const { error } = await db
        .from('agent_skills')
        .upsert(upsertData, { onConflict: 'source_id,slug' })

      if (error) {
        slog.error('Upsert failed', { slug: skill.slug, error: error.message })
        stats.errors++
      } else {
        slog.debug('Upserted', { slug: skill.slug })
        stats.synced++
      }
    } catch (err) {
      slog.error('Error processing skill', { path, err: String(err) })
      stats.errors++
    }
  }

  // Catalog size after sync (not just newly-upserted rows — incremental syncs often sync 0)
  const { count: catalogCount } = await db
    .from('agent_skills')
    .select('id', { count: 'exact', head: true })
    .eq('source_id', source.id)
    .eq('is_active', true)

  await db
    .from('skill_sources')
    .update({
      last_synced_at: new Date().toISOString(),
      last_synced_count: catalogCount ?? stats.synced,
      last_sync_error: stats.errors > 0 ? `${stats.errors} errors during sync` : null,
    })
    .eq('id', source.id)

  slog.info('Sync complete', stats)
  return stats
}

// ── Log to pipeline_runs ──────────────────────────────────────────────────────
async function logPipelineRun(
  db: ReturnType<typeof getServiceClient>,
  name: string,
  rowsOut: number,
  error: string | null,
): Promise<void> {
  await db.from('pipeline_runs').insert({
    run_name: name,
    rows_in: 0,
    rows_out: rowsOut,
    rows_blocked: 0,
    error,
    metadata: { source: 'skill-sync' },
  }).then(() => {}, () => {}) // best-effort
}

// ── Main handler ──────────────────────────────────────────────────────────────
Deno.serve(withSentry(async (req: Request): Promise<Response> => {
  const authErr = requireServiceRoleAuth(req)
  if (authErr) return authErr

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'POST required' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const body = await req.json().catch(() => ({})) as { source_id?: string; force?: boolean }
  const db = getServiceClient()

  // Load enabled sources (optionally scoped to a single source)
  let query = db.from('skill_sources').select('*').eq('enabled', true)
  if (body.source_id) query = query.eq('id', body.source_id)
  const { data: sources, error: sourcesErr } = await query

  if (sourcesErr) {
    return new Response(JSON.stringify({ error: sourcesErr.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  if (!sources || sources.length === 0) {
    return new Response(JSON.stringify({ ok: true, message: 'No enabled skill sources found' }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const totals = { synced: 0, skipped: 0, errors: 0 }

  for (const source of sources as SkillSource[]) {
    try {
      const stats = await syncSource(db, source, body.force ?? false)
      totals.synced += stats.synced
      totals.skipped += stats.skipped
      totals.errors += stats.errors
    } catch (err) {
      log.error('Source sync failed', { sourceId: source.id, err: String(err) })
      totals.errors++
      await db
        .from('skill_sources')
        .update({ last_sync_error: String(err).slice(0, 500) })
        .eq('id', source.id)
    }
  }

  await logPipelineRun(db, 'skill-sync', totals.synced, totals.errors > 0 ? `${totals.errors} skill errors` : null)

  return new Response(JSON.stringify({ ok: true, ...totals }), {
    headers: { 'Content-Type': 'application/json' },
  })
}))
