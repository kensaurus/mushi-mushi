/**
 * FILE: packages/server/supabase/functions/api/routes/repo-digest.ts
 * PURPOSE: GET /v1/admin/projects/:id/codebase/digest — the connected repo
 *          as one paste: directory tree plus file contents at a pinned
 *          commit, cut to a token budget (Plan 020 §10.3.1). Backs the MCP
 *          tool `get_repo_digest` and the console's "Copy digest" buttons.
 *
 * Scope: the whole repo, one folder (`path`), or the files one report
 * touches (`report_id`). A report's files come from its stack frames, its
 * fix attempts' changed files, and related code from the index; then the
 * reverse import graph (the analyze_codebase_impact engine) adds the files
 * that depend on them. Each source is optional, so a project with no index
 * still gets the frames and fix files, and the response says which sources
 * contributed.
 *
 * Contents come straight from GitHub at one SHA (never a clone, never the
 * 300-file index), and are cached per (project, SHA, options + seeds).
 */

import type { Context, Hono } from 'npm:hono@4'
import type { Variables } from '../types.ts'
import { getServiceClient } from '../../_shared/db.ts'
import { log } from '../../_shared/logger.ts'
import { adminOrApiKey } from '../../_shared/auth.ts'
import { parseGithubRepoUrl, resolveProjectGithubToken } from '../../_shared/github.ts'
import {
  buildRepoDigestFromTree,
  clampDigestBudget,
  digestCacheKeyInput,
  fetchTreeAtSha,
  resolveCommitSha,
  sha256HexOf,
  RepoDigestError,
  type RepoDigest,
  type RepoDigestOptions,
  type RepoTreeEntry,
} from '../../_shared/repo-digest.ts'
import {
  resolveReportSeeds,
  type ReportForSeeds,
  type ReportSeeds,
  type ReportSeedSources,
} from '../../_shared/report-seeds.ts'
import { getRelevantCode } from '../../_shared/rag.ts'
import { computeImportImpact, loadExploreGraph } from '../../_shared/codebase-understand.ts'
import { emitProductEvent } from '../../_shared/product-events.ts'
import { callerCanAccessProject, dbError } from '../shared.ts'

const routeLog = log.child('repo-digest')

type Db = ReturnType<typeof getServiceClient>

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_CACHED_DIGESTS_PER_PROJECT = 20

export interface ConnectedRepo {
  owner: string
  repo: string
  token: string
}

export type RepoResolution =
  | { ok: true; repo: ConnectedRepo }
  | { ok: false; status: 400 | 404; code: string; message: string }

/** The project's connected GitHub repo (primary first) and a token that can read it. */
export async function resolveConnectedRepo(db: Db, projectId: string): Promise<RepoResolution> {
  const { data: repoRow } = await db
    .from('project_repos')
    .select('repo_url, github_app_installation_id')
    .eq('project_id', projectId)
    .order('is_primary', { ascending: false })
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (!repoRow?.repo_url) {
    return { ok: false, status: 404, code: 'NO_REPO', message: 'Connect a GitHub repo to this project first.' }
  }
  const parsed = parseGithubRepoUrl(repoRow.repo_url as string)
  if (!parsed) {
    return { ok: false, status: 400, code: 'BAD_REPO', message: 'The connected repo URL is not a GitHub repo URL.' }
  }
  const installationId = (repoRow.github_app_installation_id as number | null) ?? null
  // Never the platform GITHUB_TOKEN: these routes return repo contents, so a
  // project must read GitHub with its own credential.
  const token = await resolveProjectGithubToken(db, projectId, installationId, { allowEnvFallback: false })
  if (!token) {
    return { ok: false, status: 400, code: 'NO_GITHUB', message: 'GitHub is not connected. Add a token on the Connect page.' }
  }
  return { ok: true, repo: { owner: parsed.owner, repo: parsed.repo, token } }
}

/** The report's linked files, read from this project's database and index. */
function reportSeedSources(db: Db, projectId: string, reportId: string): ReportSeedSources {
  return {
    fixFiles: async () => {
      const { data, error } = await db
        .from('fix_attempts')
        .select('files_changed')
        .eq('report_id', reportId)
        .eq('project_id', projectId)
        .order('created_at', { ascending: false })
        .limit(5)
      if (error) throw new Error(error.message)
      return (data ?? []).map((f) => ((f.files_changed ?? []) as string[]))
    },
    relatedCode: async (summary, component) =>
      (await getRelevantCode(db, projectId, { symptom: summary, component: component ?? undefined })).map((r) => r.filePath),
    importers: async (seeds) => {
      const { nodes, edges } = await loadExploreGraph(db, projectId)
      return computeImportImpact(seeds, nodes, edges).affected_file_paths
    },
    warn: (message, detail) => routeLog.warn(message, { projectId, ...detail }),
  }
}

function splitGlobs(raw: string | undefined): string[] {
  return (raw ?? '').split(',').map((s) => s.trim()).filter(Boolean)
}

async function pruneDigestCache(db: Db, projectId: string): Promise<void> {
  const { data } = await db
    .from('repo_digest_cache')
    .select('id')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .range(MAX_CACHED_DIGESTS_PER_PROJECT, MAX_CACHED_DIGESTS_PER_PROJECT + 100)
  const ids = (data ?? []).map((r) => r.id as string)
  if (ids.length > 0) await db.from('repo_digest_cache').delete().in('id', ids)
}

type DigestScope = {
  kind: 'repo' | 'path' | 'report'
  label: string
  report_id?: string
  sources?: ReportSeeds['sources']
}

/** What the cache stores: the digest plus the scope it was built for. */
type CachedDigest = RepoDigest & { scope: DigestScope }

/**
 * A commit never changes, so a repo or folder digest stays valid forever. A
 * report digest also depends on the report's linked files (new fix attempts,
 * new stack frames), so it is rebuilt after an hour.
 */
const REPORT_DIGEST_FRESH_MS = 60 * 60 * 1000

export function isCacheFresh(scopeKey: string, createdAt: string, now: number): boolean {
  if (!scopeKey.startsWith('report:')) return true
  const t = Date.parse(createdAt)
  return Number.isFinite(t) && now - t < REPORT_DIGEST_FRESH_MS
}

/** New digests (cache misses) per user per project per hour. */
const DIGEST_BUILDS_PER_HOUR = 30

async function claimDigestBuild(db: Db, userId: string, projectId: string): Promise<'ok' | 'limited' | 'unavailable'> {
  const { error } = await db.rpc('scoped_rate_limit_claim', {
    p_user_id: userId,
    p_scope: `repo-digest:${projectId}`,
    p_max_per_window: DIGEST_BUILDS_PER_HOUR,
    p_window: '1 hour',
  })
  if (!error) return 'ok'
  if ((error.message ?? '').includes('rate_limit_exceeded')) return 'limited'
  // Fail closed: a guard that opens on an RPC error is the silent fail-open
  // pattern this repo has shipped before.
  routeLog.error('digest rate limit rpc failed', { projectId, error: error.message })
  return 'unavailable'
}

function githubFailure(c: Context, projectId: string, err: unknown): Response {
  if (err instanceof RepoDigestError) {
    const status = err.code === 'REF_NOT_FOUND' ? 404 : 502
    return c.json({ ok: false, error: { code: err.code, message: err.message } }, status)
  }
  routeLog.warn('github read failed', { projectId, error: String(err) })
  return c.json({ ok: false, error: { code: 'GITHUB_UNAVAILABLE', message: 'Could not read the repo from GitHub. Try again in a minute.' } }, 502)
}

export function registerRepoDigestRoutes(app: Hono<{ Variables: Variables }>): void {
  const readAuth = adminOrApiKey({ scope: 'mcp:read' })

  app.get('/v1/admin/projects/:id/codebase/digest', readAuth, async (c) => {
    const projectId = c.req.param('id')!
    const userId = c.get('userId') as string
    const db = getServiceClient()
    const access = await callerCanAccessProject(c, db, userId, projectId)
    if (!access.allowed) {
      return c.json({ ok: false, error: { code: 'FORBIDDEN', message: 'Not a member of this project' } }, 403)
    }

    const reportId = c.req.query('report_id')?.trim() || null
    if (reportId && !UUID_RE.test(reportId)) {
      return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'report_id must be a UUID' } }, 400)
    }
    const ref = c.req.query('ref')?.trim() || null
    if (ref && !/^[A-Za-z0-9._\/-]{1,200}$/.test(ref)) {
      return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'ref must be a branch, tag or commit SHA' } }, 400)
    }
    const pathPrefix = c.req.query('path')?.trim() || null
    const options: RepoDigestOptions = {
      budgetTokens: clampDigestBudget(c.req.query('budget')),
      include: splitGlobs(c.req.query('include')),
      exclude: splitGlobs(c.req.query('exclude')),
      pathPrefix,
    }

    let report: ReportForSeeds | null = null
    if (reportId) {
      const { data, error } = await db
        .from('reports')
        .select('id, summary, component, custom_metadata, console_logs')
        .eq('id', reportId)
        .eq('project_id', projectId)
        .maybeSingle()
      if (error) return dbError(c, error)
      if (!data) return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Report not found in this project' } }, 404)
      report = data as ReportForSeeds
    }

    const resolved = await resolveConnectedRepo(db, projectId)
    if (!resolved.ok) {
      return c.json({ ok: false, error: { code: resolved.code, message: resolved.message } }, resolved.status)
    }
    const { owner, repo, token } = resolved.repo

    // Order keeps a repeat click cheap: pin the commit (one GitHub call), then
    // the cache. Only a miss reads the tree, resolves the report's files (RAG
    // embeds the summary) and fetches contents, and only a miss is rate limited.
    let pinned: { sha: string; ref: string }
    try {
      pinned = await resolveCommitSha({ token, owner, repo, ref })
    } catch (err) {
      return githubFailure(c, projectId, err)
    }

    const scopeKey = report ? `report:${report.id}` : pathPrefix ? 'path' : 'repo'
    const optionsHash = await sha256HexOf(digestCacheKeyInput(options, scopeKey))
    const { data: cached } = await db
      .from('repo_digest_cache')
      .select('digest, created_at')
      .eq('project_id', projectId)
      .eq('commit_sha', pinned.sha)
      .eq('options_hash', optionsHash)
      .maybeSingle()

    let result: CachedDigest
    let fromCache = false
    if (cached?.digest && isCacheFresh(scopeKey, cached.created_at as string, Date.now())) {
      result = cached.digest as CachedDigest
      fromCache = true
    } else {
      const claim = await claimDigestBuild(db, userId, projectId)
      if (claim === 'limited') {
        return c.json({ ok: false, error: { code: 'RATE_LIMITED', message: `Up to ${DIGEST_BUILDS_PER_HOUR} new digests per hour per project. Copying one you already made is not limited.` } }, 429)
      }
      if (claim === 'unavailable') {
        return c.json({ ok: false, error: { code: 'RATE_LIMIT_UNAVAILABLE', message: 'Digests are paused for a moment. Try again shortly.' } }, 503)
      }

      let tree: { entries: RepoTreeEntry[]; truncated: boolean }
      try {
        tree = await fetchTreeAtSha({ token, owner, repo, sha: pinned.sha })
      } catch (err) {
        return githubFailure(c, projectId, err)
      }

      let scope: DigestScope = pathPrefix
        ? { kind: 'path', label: `folder ${pathPrefix}` }
        : { kind: 'repo', label: 'whole repo' }
      if (report) {
        const { seeds, sources } = await resolveReportSeeds(
          report,
          tree.entries.map((e) => e.path),
          reportSeedSources(db, projectId, report.id),
        )
        options.seedPaths = seeds
        scope = {
          kind: 'report',
          report_id: report.id,
          sources,
          label: seeds.length > 0
            ? `files linked to report ${report.id.slice(0, 8)} (${seeds.length}), then the rest of the repo by priority`
            : `report ${report.id.slice(0, 8)}: no linked files found, so this is the whole repo by priority`,
        }
      }

      const digest = await buildRepoDigestFromTree({
        token, owner, repo, pinned, tree, options, scopeLabel: scope.label,
      })
      result = { ...digest, scope }
      const { error: cacheErr } = await db.from('repo_digest_cache').upsert(
        // created_at is refreshed so a rebuilt report digest starts a new freshness window.
        { project_id: projectId, commit_sha: pinned.sha, options_hash: optionsHash, digest: result, created_at: new Date().toISOString() },
        { onConflict: 'project_id,commit_sha,options_hash' },
      )
      if (cacheErr) routeLog.warn('digest cache write failed', { projectId, error: cacheErr.message })
      else void pruneDigestCache(db, projectId)
    }
    const digest = result
    const scope = result.scope

    void emitProductEvent(db, {
      userId,
      eventName: 'repo_digest_created',
      surface: 'server',
      properties: {
        project_id: projectId,
        scope: scope.kind,
        budget_tokens: digest.budget_tokens,
        files: digest.files.length,
        cached: fromCache,
      },
    })

    return c.json({ ok: true, data: { ...digest, cached: fromCache } })
  })
}
