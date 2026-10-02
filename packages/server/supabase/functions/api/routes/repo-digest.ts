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

import type { Hono } from 'npm:hono@4'
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
import { framePathsFromStackText, matchFramePathsToTree } from '../../_shared/sentry-frames.ts'
import { getRelevantCode } from '../../_shared/rag.ts'
import { computeImportImpact, loadExploreGraph } from '../../_shared/codebase-understand.ts'
import { emitProductEvent } from '../../_shared/product-events.ts'
import { callerCanAccessProject, dbError } from '../shared.ts'

const routeLog = log.child('repo-digest')

type Db = ReturnType<typeof getServiceClient>

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_CACHED_DIGESTS_PER_PROJECT = 20
/** Linked files per source, and dependents added by the import graph. */
const MAX_FIX_FILES = 20
const MAX_RELATED_FILES = 5
const MAX_DEPENDENTS = 20

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
  const token = await resolveProjectGithubToken(db, projectId, installationId)
  if (!token) {
    return { ok: false, status: 400, code: 'NO_GITHUB', message: 'GitHub is not connected. Add a token on the Connect page.' }
  }
  return { ok: true, repo: { owner: parsed.owner, repo: parsed.repo, token } }
}

export interface ReportForSeeds {
  id: string
  summary: string | null
  component: string | null
  custom_metadata: unknown
  console_logs: unknown
}

export interface ReportSeeds {
  seeds: string[]
  sources: { stack_frames: number; fix_files: number; related_code: number; dependents: number }
}

/**
 * The repo files one report touches, in priority order, all present in the
 * tree at the pinned SHA. Every source is best-effort.
 */
export async function resolveReportSeeds(
  db: Db,
  projectId: string,
  report: ReportForSeeds,
  treePaths: readonly string[],
): Promise<ReportSeeds> {
  const inTree = new Set(treePaths)
  const seeds: string[] = []
  const add = (paths: readonly string[], cap: number): number => {
    let n = 0
    for (const p of paths) {
      const clean = p.replace(/\\/g, '/').replace(/^\.?\/+/, '')
      if (n >= cap || !inTree.has(clean) || seeds.includes(clean)) continue
      seeds.push(clean)
      n++
    }
    return n
  }

  // 1. Stack frames (Sentry frames, else the stored stack text).
  const meta = (report.custom_metadata ?? {}) as { sentryFrames?: unknown }
  const stored = Array.isArray(meta.sentryFrames)
    ? meta.sentryFrames.filter((p): p is string => typeof p === 'string')
    : []
  const framePaths = stored.length > 0
    ? stored
    : (Array.isArray(report.console_logs) ? report.console_logs : [])
        .flatMap((l) => framePathsFromStackText((l as { stack?: string } | null)?.stack))
  const stackFrames = add(matchFramePathsToTree(framePaths, treePaths), MAX_FIX_FILES)

  // 2. Files earlier fix attempts changed.
  let fixFiles = 0
  const { data: fixes, error: fixErr } = await db
    .from('fix_attempts')
    .select('files_changed')
    .eq('report_id', report.id)
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(5)
  if (fixErr) routeLog.warn('fix files lookup failed', { error: fixErr.message })
  for (const f of fixes ?? []) {
    fixFiles += add(((f.files_changed ?? []) as string[]).filter(Boolean), MAX_FIX_FILES - fixFiles)
  }

  // 3. Related code from the index (needs codebase indexing; empty otherwise).
  let relatedCode = 0
  if (report.summary) {
    try {
      const rag = await getRelevantCode(db, projectId, {
        symptom: report.summary,
        component: report.component ?? undefined,
      })
      relatedCode = add(rag.map((r) => r.filePath), MAX_RELATED_FILES)
    } catch (err) {
      routeLog.warn('related code lookup failed', { error: String(err) })
    }
  }

  // 4. Files that import the ones above (reverse import graph).
  let dependents = 0
  if (seeds.length > 0) {
    try {
      const { nodes, edges } = await loadExploreGraph(db, projectId)
      const impact = computeImportImpact(seeds, nodes, edges)
      dependents = add(impact.affected_file_paths.filter((p) => !seeds.includes(p)), MAX_DEPENDENTS)
    } catch (err) {
      routeLog.warn('import graph lookup failed', { error: String(err) })
    }
  }

  return {
    seeds,
    sources: { stack_frames: stackFrames, fix_files: fixFiles, related_code: relatedCode, dependents },
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

    let pinned: { sha: string; ref: string }
    let tree: { entries: RepoTreeEntry[]; truncated: boolean }
    try {
      pinned = await resolveCommitSha({ token, owner, repo, ref })
      tree = await fetchTreeAtSha({ token, owner, repo, sha: pinned.sha })
    } catch (err) {
      if (err instanceof RepoDigestError) {
        const status = err.code === 'REF_NOT_FOUND' ? 404 : 502
        return c.json({ ok: false, error: { code: err.code, message: err.message } }, status)
      }
      routeLog.warn('github read failed', { projectId, error: String(err) })
      return c.json({ ok: false, error: { code: 'GITHUB_UNAVAILABLE', message: 'Could not read the repo from GitHub. Try again in a minute.' } }, 502)
    }

    let scope: { kind: 'repo' | 'path' | 'report'; label: string; report_id?: string; sources?: ReportSeeds['sources'] } =
      pathPrefix
        ? { kind: 'path', label: `folder ${pathPrefix}` }
        : { kind: 'repo', label: 'whole repo' }
    if (report) {
      const treePaths = tree.entries.map((e) => e.path)
      const { seeds, sources } = await resolveReportSeeds(db, projectId, report, treePaths)
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

    const optionsHash = await sha256HexOf(digestCacheKeyInput(options, options.seedPaths ?? []))
    const { data: cached } = await db
      .from('repo_digest_cache')
      .select('digest')
      .eq('project_id', projectId)
      .eq('commit_sha', pinned.sha)
      .eq('options_hash', optionsHash)
      .maybeSingle()

    let digest: RepoDigest
    let fromCache = false
    if (cached?.digest) {
      digest = cached.digest as RepoDigest
      fromCache = true
    } else {
      digest = await buildRepoDigestFromTree({
        token, owner, repo, pinned, tree, options, scopeLabel: scope.label,
      })
      const { error: cacheErr } = await db.from('repo_digest_cache').upsert(
        { project_id: projectId, commit_sha: pinned.sha, options_hash: optionsHash, digest },
        { onConflict: 'project_id,commit_sha,options_hash' },
      )
      if (cacheErr) routeLog.warn('digest cache write failed', { projectId, error: cacheErr.message })
      else void pruneDigestCache(db, projectId)
    }

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

    return c.json({ ok: true, data: { ...digest, scope, cached: fromCache } })
  })
}
