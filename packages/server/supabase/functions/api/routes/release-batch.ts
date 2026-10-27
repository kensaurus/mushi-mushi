/**
 * FILE: packages/server/supabase/functions/api/routes/release-batch.ts
 * PURPOSE: The /releases "Batch" tab (console ops plan 2026-10-27, P1),
 *          served by `api-ext` (deploy size limit; `api` forwards the path).
 *
 *   GET /v1/admin/release-batch   ?projectId= one app, or every app the caller can open
 *
 * Read-only: per repo, the open or next release train (ADR 0044), its
 * members with Opus's verdict and CI at their current commit, the rules each
 * must pass, the migration files in their changes, and the deploy seen after
 * the last train merged. The view is built by `_shared/release-batch.ts`
 * from the merge queue's own predicates; this file does the reads. Mushi
 * never applies a host app's migrations.
 *
 * The members' changed files come from GitHub (one harmless read per PR),
 * cached by repo, PR and head for 10 minutes. Everything else is stored
 * state. A read that fails is named in `partial`, never shown as "none".
 */

import type { Context, Hono } from 'npm:hono@4'
import type { Variables } from '../types.ts'
import { getServiceClient } from '../../_shared/db.ts'
import { jwtAuth } from '../../_shared/auth.ts'
import { log } from '../../_shared/logger.ts'
import { fetchPullRequestFiles, parseGithubRepoUrl, resolveProjectGithubToken } from '../../_shared/github.ts'
import { ciJobsForHeads } from '../../_shared/review-followup-db.ts'
import { ciHeadState } from '../../_shared/review-followup.ts'
import { createTtlCache, SETUP_GAPS_CACHE_MS } from '../../_shared/setup-gaps.ts'
import {
  batchSettingsFrom,
  buildRepoBatch,
  recipeMigrationsDir,
  trainMembers,
  type BatchAttempt,
  type BatchQueueRow,
  type BatchReview,
  type BatchTrainRow,
  type DeployObservation,
  type HeadCi,
  type MemberFiles,
  type RepoBatch,
} from '../../_shared/release-batch.ts'
import { enumerateAccessibleProjectIds, userCanAccessProject } from '../shared.ts'

const rlog = log.child('release-batch')

type Ctx = Context<{ Variables: Variables }>
type Db = ReturnType<typeof getServiceClient>

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DAY = 24 * 3600_000
const IN_CHUNK = 100
/** GitHub file reads per request; members past it are listed as not read. */
const MAX_FILE_READS = 40
const FILE_CONCURRENCY = 6
const FILE_MS = 8_000

const filesCache = createTtlCache<MemberFiles>(SETUP_GAPS_CACHE_MS, 2000)

/** @internal Tests reset the per-isolate cache between cases. */
export function clearReleaseBatchCache(): void {
  filesCache.clear()
}

export interface ReleaseBatchDeps {
  now: () => Date
  token: (db: Db, projectId: string, installationId: number | null) => Promise<string | null>
  pullFiles: (token: string, repo: { owner: string; repo: string }, pr: number) => Promise<MemberFiles | null>
}

export const defaultReleaseBatchDeps: ReleaseBatchDeps = {
  now: () => new Date(),
  token: (db, projectId, installationId) => resolveProjectGithubToken(db, projectId, installationId),
  pullFiles: async (token, ref, pr) => {
    const got = await fetchPullRequestFiles(token, ref, pr, { maxPages: 3 })
    return got ? { files: got.files.map((f) => ({ filename: f.filename, previousFilename: f.previousFilename ?? null })), complete: got.complete } : null
  },
}

function within<T>(p: PromiseLike<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('timed out')), ms)
  })
  return Promise.race([Promise.resolve(p), deadline]).finally(() => clearTimeout(timer))
}

async function inChunks<T>(ids: string[], read: (chunk: string[]) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = []
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const { data, error } = await read(ids.slice(i, i + IN_CHUNK))
    if (error) throw new Error(error.message)
    out.push(...((data ?? []) as T[]))
  }
  return out
}

const repoKey = (url: string | null) => {
  const ref = parseGithubRepoUrl(url)
  return ref ? `${ref.owner}/${ref.repo}`.toLowerCase() : null
}

export async function readReleaseBatch(db: Db, projectIds: string[], deps: ReleaseBatchDeps) {
  const now = deps.now()
  const since7 = new Date(now.getTime() - 7 * DAY).toISOString()
  const since14 = new Date(now.getTime() - 14 * DAY).toISOString()
  const [projectsRes, settingsRes, reposRes, queueRes, trainsRes, recipeRes, deploysRes] = await Promise.all([
    db.from('projects').select('id, name').in('id', projectIds),
    db.from('project_settings').select('project_id, release_mode, train_interval_minutes, train_max_members').in('project_id', projectIds),
    db.from('project_repos').select('project_id, repo_url, github_app_installation_id, is_primary').in('project_id', projectIds),
    db
      .from('fix_merge_queue')
      .select('id, fix_attempt_id, project_id, repo, pr_number, state, detail, queued_at, train_id')
      .in('project_id', projectIds)
      .in('state', ['queued', 'waiting', 'resolving', 'blocked'])
      .limit(2000),
    db
      .from('release_trains')
      .select('id, project_id, repo, pr_number, state, members, attempt, detail, head_sha, merge_sha, created_at, merged_at')
      .in('project_id', projectIds)
      .gte('created_at', since7)
      .order('created_at', { ascending: false })
      .limit(1000),
    db.from('app_recipe_snapshots').select('project_id, manifest').in('project_id', projectIds).eq('is_current', true),
    db.from('deploy_observations').select('project_id, observed_at, observed_commit, observed_version, ok').in('project_id', projectIds).gte('observed_at', since14).limit(2000),
  ])
  for (const r of [projectsRes, settingsRes, reposRes, queueRes, trainsRes]) if (r.error) throw new Error(r.error.message)
  const partial: string[] = []
  if (recipeRes.error) partial.push('recipe')
  if (deploysRes.error) partial.push('deploys')

  type Q = BatchQueueRow & { project_id: string }
  type T = BatchTrainRow & { project_id: string }
  const queue = ((queueRes.data ?? []) as Q[]).map((q) => ({ ...q, repo: q.repo.toLowerCase() }))
  const trains = ((trainsRes.data ?? []) as T[]).map((t) => ({ ...t, repo: t.repo.toLowerCase() }))
  const repoRows = (reposRes.data ?? []) as Array<{ project_id: string; repo_url: string | null; github_app_installation_id: number | string | null; is_primary: boolean | null }>

  // Fix attempts behind every queued row and every open train's members.
  const openTrains = trains.filter((t) => t.state === 'building' || t.state === 'testing')
  const attemptIds = [...new Set([...queue.map((q) => q.fix_attempt_id), ...openTrains.flatMap((t) => trainMembers(t.members).map((m) => m.fixAttemptId))])]
  const attemptRows = await inChunks<{ id: string; report_id: string | null; pr_url: string | null; pr_state: string | null; commit_sha: string | null; check_run_conclusion: string | null }>(
    attemptIds,
    (ids) => db.from('fix_attempts').select('id, report_id, pr_url, pr_state, commit_sha, check_run_conclusion').in('id', ids),
  )
  const reportIds = [...new Set(attemptRows.map((a) => a.report_id).filter((x): x is string => !!x))]
  const [reportRows, reviews] = await Promise.all([
    inChunks<{ id: string; title: string | null; summary: string | null; severity: string | null; source: string | null }>(reportIds, (ids) =>
      db.from('reports').select('id, title, summary, severity, source').in('id', ids),
    ),
    inChunks<BatchReview>(attemptIds, (ids) => db.from('fix_reviews').select('fix_attempt_id, verdict, head_sha, status, completed_at, created_at').in('fix_attempt_id', ids)),
  ])
  const reports = new Map(reportRows.map((r) => [r.id, r]))
  const attempts = new Map<string, BatchAttempt>(
    attemptRows.map((a) => {
      const r = a.report_id ? reports.get(a.report_id) : undefined
      return [a.id, { id: a.id, prUrl: a.pr_url, prState: a.pr_state, headSha: a.commit_sha, checkRunConclusion: a.check_run_conclusion, title: r?.title ?? r?.summary ?? null, severity: r?.severity ?? null, source: r?.source ?? null }]
    }),
  )

  // CI per commit, from the stored jobs.
  const heads = [
    ...attemptRows.map((a) => a.commit_sha ?? ''),
    ...openTrains.flatMap((t) => [t.head_sha ?? '', ...trainMembers(t.members).map((m) => m.headSha ?? '')]),
  ].filter(Boolean)
  const ciByHead = new Map<string, HeadCi>()
  try {
    for (const [head, rows] of await ciJobsForHeads(db as never, projectIds, heads)) {
      const s = ciHeadState(rows)
      ciByHead.set(head, { state: s.state, failing: s.state === 'base_failing' ? s.onBase : s.failing.map((f) => f.name) })
    }
  } catch (err) {
    partial.push('ci')
    rlog.warn('ci jobs read failed', { err: err instanceof Error ? err.message : String(err) })
  }

  // One batch per repo: every connected repo, plus any repo with a queue row or a train.
  const names = new Map(((projectsRes.data ?? []) as Array<{ id: string; name: string }>).map((p) => [p.id, p.name]))
  const settings = new Map(((settingsRes.data ?? []) as Array<{ project_id: string }>).map((s) => [s.project_id, s]))
  const recipes = new Map(((recipeRes.data ?? []) as Array<{ project_id: string; manifest: unknown }>).map((r) => [r.project_id, r.manifest]))
  const deploys = (deploysRes.data ?? []) as Array<DeployObservation & { project_id: string }>
  const pairs = new Map<string, { projectId: string; repo: string; installationId: number | null }>()
  const add = (projectId: string, repo: string | null, installationId: number | null = null) => {
    if (!repo) return
    const k = `${projectId}|${repo}`
    const prev = pairs.get(k)
    if (!prev || (!prev.installationId && installationId)) pairs.set(k, { projectId, repo, installationId })
  }
  for (const r of repoRows) add(r.project_id, repoKey(r.repo_url), Number(r.github_app_installation_id) || null)
  for (const q of queue) add(q.project_id, q.repo)
  for (const t of trains) add(t.project_id, t.repo)

  // Changed files of every listed member (cached by repo, PR and head).
  const jobs: Array<{ key: string; projectId: string; repo: string; installationId: number | null; pr: number; fixAttemptId: string }> = []
  for (const p of pairs.values()) {
    const open = openTrains.find((t) => t.project_id === p.projectId && t.repo === p.repo)
    const members = [
      ...(open ? trainMembers(open.members).map((m) => ({ fixAttemptId: m.fixAttemptId, pr: m.prNumber, head: m.headSha })) : []),
      ...queue.filter((q) => q.project_id === p.projectId && q.repo === p.repo).map((q) => ({ fixAttemptId: q.fix_attempt_id, pr: q.pr_number, head: attempts.get(q.fix_attempt_id)?.headSha ?? null })),
    ]
    for (const m of members) jobs.push({ key: `${p.repo}#${m.pr}@${m.head ?? ''}`, projectId: p.projectId, repo: p.repo, installationId: p.installationId, pr: m.pr, fixAttemptId: m.fixAttemptId })
  }
  const files = new Map<string, MemberFiles | null>()
  const nowMs = now.getTime()
  const toRead = jobs.filter((j) => {
    const hit = filesCache.get(j.key, nowMs)
    if (hit) files.set(j.fixAttemptId, hit.value)
    return !hit
  })
  const tokens = new Map<string, Promise<string | null>>()
  const tokenFor = (j: (typeof jobs)[number]) => {
    const k = `${j.projectId}|${j.installationId ?? ''}`
    if (!tokens.has(k)) tokens.set(k, deps.token(db, j.projectId, j.installationId).catch(() => null))
    return tokens.get(k)!
  }
  const batch = toRead.slice(0, MAX_FILE_READS)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(FILE_CONCURRENCY, batch.length) }, async () => {
      while (next < batch.length) {
        const j = batch[next++]
        const [owner, name] = j.repo.split('/')
        const token = await tokenFor(j)
        if (!token) {
          files.set(j.fixAttemptId, null)
          continue
        }
        try {
          const got = await within(deps.pullFiles(token, { owner, repo: name }, j.pr), FILE_MS)
          files.set(j.fixAttemptId, got)
          if (got) filesCache.set(j.key, got, nowMs)
        } catch {
          files.set(j.fixAttemptId, null)
        }
      }
    }),
  )
  if (toRead.length > MAX_FILE_READS) partial.push('files')

  const repos: RepoBatch[] = [...pairs.values()].map((p) =>
    buildRepoBatch({
      now,
      projectId: p.projectId,
      projectName: names.get(p.projectId) ?? 'this app',
      repo: p.repo,
      settings: batchSettingsFrom((settings.get(p.projectId) ?? null) as never),
      trains: trains.filter((t) => t.project_id === p.projectId && t.repo === p.repo),
      queue: queue.filter((q) => q.project_id === p.projectId && q.repo === p.repo),
      attempts,
      reviews,
      ciByHead,
      migrationsDir: recipeMigrationsDir(recipes.get(p.projectId)),
      files,
      deploys: deploys.filter((d) => d.project_id === p.projectId),
    }),
  )
  // Busy repos first: an open train, then the most members.
  repos.sort((a, b) => Number(b.train.kind === 'open') - Number(a.train.kind === 'open') || b.members.length - a.members.length || a.repo.localeCompare(b.repo))
  return { generatedAt: now.toISOString(), repos, partial }
}

export function registerReleaseBatchRoutes(app: Hono<{ Variables: Variables }>, deps: ReleaseBatchDeps = defaultReleaseBatchDeps): void {
  app.get('/v1/admin/release-batch', jwtAuth, async (c: Ctx) => {
    const db = getServiceClient()
    const userId = c.get('userId') as string
    const requested = c.req.query('projectId') ?? undefined
    let ids: string[]
    if (requested) {
      if (!UUID_RE.test(requested)) return c.json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'projectId is not a uuid.' } }, 400)
      const access = await userCanAccessProject(db, userId, requested)
      if (!access.allowed) return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Project not found' } }, 404)
      ids = [requested]
    } else {
      ids = await enumerateAccessibleProjectIds(c, db, userId)
    }
    if (ids.length === 0) return c.json({ ok: true, data: { generatedAt: deps.now().toISOString(), repos: [], partial: [] } })
    try {
      return c.json({ ok: true, data: await readReleaseBatch(db, ids, deps) })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      rlog.warn('release batch read failed', { err: message.slice(0, 200) })
      return c.json({ ok: false, error: { code: 'DB_ERROR', message } }, 500)
    }
  })
}
