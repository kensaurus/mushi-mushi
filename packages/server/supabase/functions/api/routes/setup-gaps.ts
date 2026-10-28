/**
 * FILE: packages/server/supabase/functions/api/routes/setup-gaps.ts
 * PURPOSE: Setup gaps for the console's Set up page (console ops plan
 *          2026-10-27, P1), served by `api-ext` (deploy size limit; `api`
 *          forwards the path).
 *
 *   GET /v1/admin/setup-gaps   ?projectId= one app, or every app the caller can open
 *                              &refresh=1 re-check now (not more than once a minute)
 *
 * Read-only. The rules live in `_shared/setup-gaps.ts`; this file does the
 * reads and the GitHub probes. The probes are harmless reads (the App's
 * token mint, GET on the repo, its pulls, Actions runs and the secrets
 * public key); Mushi never writes to find out whether it may write. Tokens
 * are never logged or returned. Mushi's own fallback token (GITHUB_TOKEN)
 * is never probed: the repo URL is the tenant's, so the answer would say
 * what Mushi's token can reach.
 *
 * Every check reads on its own with a deadline: a slow or failing read makes
 * that line `unknown`, never a missing line. Results are cached for
 * SETUP_GAPS_CACHE_MS per app, after the access check. Platform secrets
 * (audience 'platform') are not here: they are in the super-admin doctor.
 */

import type { Context, Hono } from 'npm:hono@4'
import type { Variables } from '../types.ts'
import { getServiceClient } from '../../_shared/db.ts'
import { jwtAuth } from '../../_shared/auth.ts'
import { log } from '../../_shared/logger.ts'
import { fetchWithTimeout } from '../../_shared/http.ts'
import { mintInstallationAccess, parseGithubRepoUrl, resolveProjectGithubToken, type GithubRepoRef } from '../../_shared/github.ts'
import { loadFollowupSettings } from '../../_shared/review-followup-db.ts'
import {
  abilitiesFromClassicScopes,
  abilitiesFromInstallation,
  abilitiesFromReadProbes,
  autofixKeyGap,
  clearRepoAbilities,
  countByStatus,
  createTtlCache,
  deployGap,
  followupKeyGap,
  forAudience,
  githubAccessGap,
  noRepoGap,
  rememberRepoAbilities,
  SETUP_GAPS_CACHE_MS,
  slackGap,
  sortGaps,
  type RepoAccessInput,
  type SetupGap,
  type TokenAbilities,
} from '../../_shared/setup-gaps.ts'
import { readDispatchers, type DispatcherProject } from './pipeline.ts'
import { enumerateAccessibleProjectIds, userCanAccessProject } from '../shared.ts'

const slog = log.child('setup-gaps')

type Ctx = Context<{ Variables: Variables }>
type Db = ReturnType<typeof getServiceClient>

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** Each check's budget; a slower one reads `unknown`. */
const CHECK_MS = 12_000
/** Each GitHub call's budget. */
const GITHUB_MS = 6_000
/** Repos probed per app; the rest are listed as not checked. */
const MAX_REPOS = 5
/** Apps checked per request in "every app" mode, and at once. */
const MAX_PROJECTS = 30
const PROJECT_CONCURRENCY = 4
/** A refresh within this long of the last check reuses it. */
const REFRESH_MIN_MS = 60_000

export interface ProjectGaps {
  projectId: string
  name: string
  checkedAt: string
  gaps: SetupGap[]
}

const cache = createTtlCache<ProjectGaps>(SETUP_GAPS_CACHE_MS)

/** @internal Tests reset the per-isolate cache between cases. */
export function clearSetupGapsCache(): void {
  cache.clear()
  clearRepoAbilities()
}

interface RepoRow {
  repo_url: string | null
  github_app_installation_id: number | string | null
  is_primary: boolean | null
}

export interface SetupGapsDeps {
  now: () => Date
  mintInstallation: typeof mintInstallationAccess
  resolvePat: (db: Db, projectId: string) => Promise<string | null>
  platformToken: () => string | null
  /** A GitHub GET: its status and the classic-token scope header (null when GitHub sent none). */
  githubGet: (token: string, path: string) => Promise<{ status: number; scopes: string | null } | null>
  readDispatchers: typeof readDispatchers
}

export const defaultSetupGapsDeps: SetupGapsDeps = {
  now: () => new Date(),
  mintInstallation: mintInstallationAccess,
  resolvePat: (db, projectId) => resolveProjectGithubToken(db, projectId, null, { allowEnvFallback: false }),
  platformToken: () => Deno.env.get('GITHUB_TOKEN') ?? null,
  githubGet: async (token, path) => {
    const res = await fetchWithTimeout(
      `https://api.github.com${path}`,
      { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' } },
      GITHUB_MS,
    ).catch(() => null)
    if (!res) return null
    await res.body?.cancel().catch(() => {})
    return { status: res.status, scopes: res.headers.get('x-oauth-scopes') }
  },
  readDispatchers,
}

function within<T>(p: PromiseLike<T>, what: string, ms = CHECK_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} took longer than ${ms / 1000}s`)), ms)
  })
  return Promise.race([Promise.resolve(p), deadline]).finally(() => clearTimeout(timer))
}

/** The reason in plain words: a database statement timeout is not shown as its raw Postgres text. */
function why(err: unknown): string {
  const text = err instanceof Error ? err.message : typeof err === 'object' && err && 'message' in err ? String((err as { message: unknown }).message) : String(err)
  const code = typeof err === 'object' && err && 'code' in err ? String((err as { code: unknown }).code) : ''
  if (code === '57014' || /statement timeout|canceling statement/i.test(text)) return 'the database was too slow to answer; try again in a minute'
  return text.slice(0, 160)
}

const reachable = (status: number | null | undefined): boolean | null =>
  status == null ? null : status >= 200 && status < 300 ? true : status === 403 || status === 404 ? false : null

/** What the token Mushi would use for this repo can do, from harmless reads only. */
async function probeRepo(db: Db, projectId: string, repo: GithubRepoRef, installationId: number | null, deps: SetupGapsDeps): Promise<RepoAccessInput> {
  const name = `${repo.owner}/${repo.repo}`
  const path = `/repos/${repo.owner}/${repo.repo}`
  // 1. The GitHub App, when this repo has an installation (the order resolveProjectGithubToken uses).
  if (installationId && installationId > 0) {
    const minted = await deps.mintInstallation(installationId).catch(() => null)
    if (minted) {
      const r = await deps.githubGet(minted.token, path)
      const reach = reachable(r?.status)
      if (reach === null && !minted.permissions) return { projectId, repo: name, source: 'app', abilities: null, readError: 'GitHub did not answer' }
      return { projectId, repo: name, source: 'app', abilities: abilitiesFromInstallation(minted.permissions, reach), readError: null }
    }
  }
  // 2. A stored token (the app's, then its team's).
  const pat = await deps.resolvePat(db, projectId)
  if (!pat) {
    // 3. Mushi's own fallback token is never probed: the repo URL is the
    // tenant's choice, so the answer would tell any app owner what Mushi's
    // token can reach.
    return { projectId, repo: name, source: deps.platformToken() ? 'platform' : 'none', abilities: null, readError: null }
  }
  const token = pat
  const head = await deps.githubGet(token, path)
  if (!head || (head.status >= 500 && head.status < 600)) {
    return { projectId, repo: name, source: 'pat_fine_grained', abilities: null, readError: head ? `GitHub answered ${head.status}` : 'GitHub did not answer' }
  }
  // A classic token states its scopes on every answer; a fine-grained one does not.
  if (head.scopes !== null) {
    return { projectId, repo: name, source: 'pat_classic', abilities: abilitiesFromClassicScopes(head.scopes, head.status === 200), readError: null }
  }
  let abilities: TokenAbilities
  if (reachable(head.status) === false) {
    abilities = { contents: 'no', pullRequests: 'no', actions: 'no', secrets: 'no', workflows: 'no' }
  } else {
    const [contents, pulls, runs, secrets] = await Promise.all([
      deps.githubGet(token, `${path}/commits?per_page=1`),
      deps.githubGet(token, `${path}/pulls?per_page=1&state=all`),
      deps.githubGet(token, `${path}/actions/runs?per_page=1`),
      deps.githubGet(token, `${path}/actions/secrets/public-key`),
    ])
    abilities = abilitiesFromReadProbes({
      contents: contents?.status ?? null,
      pullRequests: pulls?.status ?? null,
      actions: runs?.status ?? null,
      secrets: secrets?.status ?? null,
    })
  }
  return { projectId, repo: name, source: 'pat_fine_grained', abilities, readError: null }
}

async function githubGaps(db: Db, projectId: string, deps: SetupGapsDeps): Promise<SetupGap[]> {
  let rows: RepoRow[]
  try {
    const { data, error } = await within(
      db.from('project_repos').select('repo_url, github_app_installation_id, is_primary').eq('project_id', projectId).limit(50),
      'repos',
    )
    if (error) throw new Error(error.message)
    rows = (data ?? []) as RepoRow[]
  } catch (err) {
    return [{ ...noRepoGap(projectId), status: 'unknown', summary: `Mushi could not read this app's repos (${why(err)}).` }]
  }
  const repos = rows
    .map((r) => ({ ref: parseGithubRepoUrl(r.repo_url), installationId: Number(r.github_app_installation_id) || null, primary: !!r.is_primary }))
    .filter((r): r is { ref: GithubRepoRef; installationId: number | null; primary: boolean } => !!r.ref)
    .sort((a, b) => Number(b.primary) - Number(a.primary))
  if (repos.length === 0) return [noRepoGap(projectId)]
  const out = await Promise.all(
    repos.slice(0, MAX_REPOS).map(async (r) => {
      const name = `${r.ref.owner}/${r.ref.repo}`
      try {
        const access = await within(probeRepo(db, projectId, r.ref, r.installationId, deps), `GitHub check of ${name}`)
        if (access.abilities) rememberRepoAbilities(projectId, name, access.abilities, deps.now().getTime())
        return githubAccessGap(access)
      } catch (err) {
        return githubAccessGap({ projectId, repo: name, source: 'app', abilities: null, readError: why(err) })
      }
    }),
  )
  for (const r of repos.slice(MAX_REPOS)) {
    const name = `${r.ref.owner}/${r.ref.repo}`
    out.push(githubAccessGap({ projectId, repo: name, source: 'app', abilities: null, readError: `only the first ${MAX_REPOS} repos are checked` }))
  }
  return out
}

async function followupGap(db: Db, project: DispatcherProject): Promise<SetupGap> {
  try {
    if (!project.organization_id) {
      return followupKeyGap({ projectId: project.id, settings: { enabled: false, offReason: null, keyId: null } })
    }
    const settings = await within(loadFollowupSettings(db as never, project.organization_id), 'follow-up settings')
    let keyStatus: string | null | undefined
    if (settings.enabled && settings.keyId) {
      const { data, error } = await within(db.from('byok_keys').select('status').eq('id', settings.keyId).maybeSingle(), 'follow-up key')
      if (error) throw new Error(error.message)
      keyStatus = (data as { status: string } | null)?.status ?? null
    }
    return followupKeyGap({ projectId: project.id, settings, keyStatus })
  } catch (err) {
    return { ...followupKeyGap({ projectId: project.id, settings: null }), summary: `Mushi could not read the review follow-up settings (${why(err)}).` }
  }
}

async function dispatchGap(db: Db, project: DispatcherProject, now: Date, deps: SetupGapsDeps): Promise<SetupGap> {
  const list = await within(deps.readDispatchers(db, [project.id], [project], now), 'auto-fix setting').catch(() => null)
  return autofixKeyGap({ projectId: project.id, dispatcher: list?.find((d) => d.projectId === project.id) ?? null })
}

async function deployEventsGap(db: Db, projectId: string, now: Date): Promise<SetupGap> {
  try {
    const { data, error } = await within(
      db.from('deploy_observations').select('observed_at').eq('project_id', projectId).order('observed_at', { ascending: false }).limit(1),
      'deploy events',
    )
    if (error) throw new Error(error.message)
    return deployGap(projectId, ((data ?? []) as Array<{ observed_at: string }>)[0]?.observed_at ?? null, now)
  } catch (err) {
    return { ...deployGap(projectId, undefined, now), summary: `Mushi could not read the deploy events (${why(err)}).` }
  }
}

async function slackTokenGap(db: Db, projectId: string, now: Date): Promise<SetupGap> {
  try {
    const [settings, health] = await within(
      Promise.all([
        db.from('project_settings').select('slack_bot_token_ref').eq('project_id', projectId).maybeSingle(),
        db
          .from('integration_health_history')
          .select('status, message, checked_at')
          .eq('project_id', projectId)
          .eq('kind', 'slack')
          .order('checked_at', { ascending: false })
          .limit(1),
      ]),
      'Slack',
    )
    if (settings.error) throw new Error(settings.error.message)
    if (health.error) throw new Error(health.error.message)
    const connected = !!(settings.data as { slack_bot_token_ref: string | null } | null)?.slack_bot_token_ref
    const latest = ((health.data ?? []) as Array<{ status: string; message: string | null; checked_at: string }>)[0] ?? null
    return slackGap({ projectId, connected, latest }, now)
  } catch (err) {
    return { ...slackGap({ projectId, connected: null, latest: null }, now), summary: `Mushi could not read the Slack connection (${why(err)}).` }
  }
}

/** Every app-owner check for one app. Each check settles on its own. */
export async function checkProject(db: Db, project: DispatcherProject, deps: SetupGapsDeps): Promise<ProjectGaps> {
  const now = deps.now()
  const [github, followup, dispatch, deploy, slack] = await Promise.all([
    githubGaps(db, project.id, deps),
    followupGap(db, project),
    dispatchGap(db, project, now, deps),
    deployEventsGap(db, project.id, now),
    slackTokenGap(db, project.id, now),
  ])
  return {
    projectId: project.id,
    name: project.name,
    checkedAt: now.toISOString(),
    gaps: sortGaps(forAudience([...github, followup, dispatch, deploy, slack], 'app_owner')),
  }
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++
        out[i] = await fn(items[i])
      }
    }),
  )
  return out
}

export function registerSetupGapsRoutes(app: Hono<{ Variables: Variables }>, deps: SetupGapsDeps = defaultSetupGapsDeps): void {
  app.get('/v1/admin/setup-gaps', jwtAuth, async (c: Ctx) => {
    const db = getServiceClient()
    const userId = c.get('userId') as string
    const requested = c.req.query('projectId') ?? undefined
    // Access first: the cache is read only for apps the caller may open.
    let ids: string[]
    if (requested) {
      if (!UUID_RE.test(requested)) return c.json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'projectId is not a uuid.' } }, 400)
      const access = await userCanAccessProject(db, userId, requested)
      if (!access.allowed) return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Project not found' } }, 404)
      ids = [requested]
    } else {
      ids = await enumerateAccessibleProjectIds(c, db, userId)
    }
    const truncated = ids.length > MAX_PROJECTS
    ids = ids.slice(0, MAX_PROJECTS)
    if (ids.length === 0) return c.json({ ok: true, data: { generatedAt: deps.now().toISOString(), projects: [], counts: countByStatus([]), truncated: false } })

    const { data: projectRows, error } = await db.from('projects').select('id, name, organization_id, owner_id').in('id', ids)
    if (error) return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 500)
    const projects = (projectRows ?? []) as DispatcherProject[]
    const refresh = c.req.query('refresh') === '1'
    const nowMs = deps.now().getTime()
    const results = await mapLimit(projects, PROJECT_CONCURRENCY, async (p) => {
      const hit = cache.get(p.id, nowMs)
      if (hit && (!refresh || nowMs - hit.at < REFRESH_MIN_MS)) return hit.value
      const fresh = await checkProject(db, p, deps)
      cache.set(p.id, fresh, nowMs)
      return fresh
    })
    const all = results.flatMap((r) => r.gaps)
    slog.info('setup gaps read', { projects: results.length, ...countByStatus(all) })
    return c.json({
      ok: true,
      data: {
        generatedAt: deps.now().toISOString(),
        projects: results.sort((a, b) => a.name.localeCompare(b.name)),
        counts: countByStatus(all),
        truncated,
      },
    })
  })
}
