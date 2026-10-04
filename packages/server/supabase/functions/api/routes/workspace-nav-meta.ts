/**
 * GET /v1/admin/workspace/nav-meta
 *
 * Consolidates sidebar stat slices into one round trip. Fans out to the
 * existing /stats handlers in parallel (same auth + project headers) so badge
 * logic stays single-sourced on each route.
 *
 * `?include=counts[,inventory][,superadmin]` also folds in the sidebar's
 * per-item counters (fixes summary, untriaged reports, notifications, queue,
 * flagged devices, support replies, judge disagreements, inbox) that the
 * console used to fetch as ~10 separate requests on every page. The same
 * routes answer them, so each count keeps its meaning.
 *
 * Cost control (it used to take 4-5.5 s on every page):
 *   - the JWT is verified once here; sub-requests are marked trusted so the
 *     fanned-out routes skip their own GoTrue `getUser` call;
 *   - membership reads are shared across the fan-out (`withFanoutMemo`);
 *   - the answer is cached per user + team + project for NAV_META_TTL_MS;
 *     `?fresh=1` (sent after a realtime change) bypasses the cached copy.
 * `timingsMs` names each slice's cost so a slow one is findable.
 *
 * The slices are dispatched IN-PROCESS through `app.fetch`, never over HTTP.
 * Each HTTP self-call used to re-enter the Edge Runtime as a function-to-
 * function request, and the runtime caps those per execution trace: ~37
 * slices in one trace tripped "Rate limit exceeded for trace <id>" and the
 * last ~7 slices came back null on every console page load.
 */

import type { Hono, MiddlewareHandler } from 'npm:hono@4'
import { jwtAuth } from '../../_shared/auth.ts'
import { log } from '../../_shared/logger.ts'
import { trustSubRequest, withFanoutMemo, type TrustedUser } from '../../_shared/request-memo.ts'
import { getServiceClient } from '../../_shared/db.ts'
import { accessibleProjectIds } from '../../_shared/project-access.ts'
import type { Variables } from '../types.ts'

const nlog = log.child('workspace-nav-meta')

type JsonRecord = Record<string, unknown>

const NAV_META_PATH = '/v1/admin/workspace/nav-meta'

/** Runs one stats route and returns the Response — no network hop. */
export type SliceDispatcher = (path: string, headers: Headers) => Promise<Response>

/** Outcome of one slice; `error` names why a slice is missing so it is never silent. */
export interface SliceResult {
  data: JsonRecord | null
  error: string | null
}

export async function fetchStatsSlice(
  dispatch: SliceDispatcher,
  path: string,
  headers: Headers,
): Promise<SliceResult> {
  try {
    const res = await dispatch(path, headers)
    if (!res.ok) {
      nlog.warn('nav_meta_slice_failed', { path, status: res.status })
      return { data: null, error: `HTTP ${res.status}` }
    }
    const body = (await res.json()) as { ok?: boolean; data?: JsonRecord }
    if (!body.ok) return { data: null, error: 'not ok' }
    return { data: body.data ?? null, error: null }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    nlog.warn('nav_meta_slice_error', { path, err: message })
    return { data: null, error: message.slice(0, 200) }
  }
}

/**
 * Dispatcher that hands each slice to the same Hono app in-process. The
 * route prefix (Supabase mounts the api function under `/api`) is read off
 * the incoming URL so it matches whatever basePath the app was built with.
 */
export function inProcessDispatcher(
  app: { fetch: (req: Request) => Response | Promise<Response> },
  requestUrl: string,
  verifiedUser: TrustedUser | null = null,
): SliceDispatcher {
  const url = new URL(requestUrl)
  const prefix = url.pathname.endsWith(NAV_META_PATH)
    ? url.pathname.slice(0, -NAV_META_PATH.length)
    : ''
  return (path, headers) => {
    const req = new Request(`${url.origin}${prefix}${path}`, { headers })
    // The outer request already verified this token; let jwtAuth on the
    // slice reuse that instead of a GoTrue round trip per slice.
    if (verifiedUser) trustSubRequest(req, verifiedUser)
    return Promise.resolve(app.fetch(req))
  }
}

/** How long one user's nav-meta answer is reused before recomputing. */
export const NAV_META_TTL_MS = 15_000
const NAV_META_CACHE_MAX = 500

interface CachedNavMeta {
  expiresAt: number
  data: JsonRecord
}

const navMetaCache = new Map<string, CachedNavMeta>()

function readCache(key: string, now: number): JsonRecord | null {
  const hit = navMetaCache.get(key)
  if (!hit) return null
  if (hit.expiresAt <= now) {
    navMetaCache.delete(key)
    return null
  }
  return hit.data
}

function writeCache(key: string, data: JsonRecord, now: number): void {
  navMetaCache.delete(key)
  navMetaCache.set(key, { expiresAt: now + NAV_META_TTL_MS, data })
  while (navMetaCache.size > NAV_META_CACHE_MAX) {
    const oldest = navMetaCache.keys().next().value
    if (oldest === undefined) break
    navMetaCache.delete(oldest)
  }
}

/** Test hook: forget every cached answer. */
export function clearNavMetaCache(): void {
  navMetaCache.clear()
}

type NavMetaInclude = 'counts' | 'inventory' | 'superadmin'

const NAV_META_SLICE_KEYS = [
  'contentQuality',
  'codeHealth',
  'qaCoverage',
  'experiments',
  'lessons',
  'drift',
  'anomalies',
  'iterate',
  'onboarding',
  'rewards',
  'billing',
  'audit',
  'intelligence',
  'releases',
  'fullstackAudit',
  'dashboard',
  'explore',
  'promptLab',
  'research',
  'graph',
  'inventory',
  'health',
  'fixes',
  'repo',
  'mcp',
  'marketplace',
  'settings',
  'costs',
  'sso',
  'compliance',
  'storage',
  'query',
  'integrations',
  'featureBoard',
  'skills',
  'projects',
  'members',
] as const

type NavMetaSliceKey = (typeof NAV_META_SLICE_KEYS)[number]

/**
 * `null` = no `slices` param: answer every slice (older consoles). An empty
 * or all-unknown list is a real request for no slices (counts only).
 */
export function parseNavMetaSlices(raw: string | undefined): Set<NavMetaSliceKey> | null {
  if (raw === undefined) return null
  const known = new Set<string>(NAV_META_SLICE_KEYS)
  const out = new Set<NavMetaSliceKey>()
  for (const part of raw.split(',')) {
    const v = part.trim()
    if (known.has(v)) out.add(v as NavMetaSliceKey)
  }
  return out
}

export function parseNavMetaInclude(raw: string | undefined): Set<NavMetaInclude> {
  const out = new Set<NavMetaInclude>()
  for (const part of (raw ?? '').split(',')) {
    const v = part.trim().toLowerCase()
    if (v === 'counts' || v === 'inventory' || v === 'superadmin') out.add(v)
  }
  return out
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function pick<T extends JsonRecord>(
  data: JsonRecord | null,
  keys: (keyof T & string)[],
): Partial<T> | null {
  if (!data) return null
  const out: Partial<T> = {}
  for (const key of keys) {
    if (key in data) (out as JsonRecord)[key] = data[key]
  }
  return out
}

export interface DirectoryTeam {
  id: string
  name: string
  role: string | null
  isPersonal: boolean
}

export interface DirectoryProject {
  id: string
  name: string
  organizationId: string | null
}

/**
 * Every project the caller can reach, in every team, with the team it belongs
 * to. The console reads this once to (a) resolve which team owns a deep-linked
 * `?project=` before its first data request and (b) list all projects grouped
 * by team in the project switcher. Teams sort as the user joined them;
 * projects sort by name inside each team.
 */
export function buildProjectDirectory(
  memberships: Array<{ role?: string | null; organizations?: unknown }>,
  projects: Array<{ id: string; name?: string | null; organization_id?: string | null }>,
): { teams: DirectoryTeam[]; projects: DirectoryProject[] } {
  const teams: DirectoryTeam[] = []
  const seen = new Set<string>()
  for (const m of memberships) {
    const org = (Array.isArray(m.organizations) ? m.organizations[0] : m.organizations) as
      | { id?: string; name?: string | null; is_personal?: boolean | null }
      | null
      | undefined
    if (!org?.id || seen.has(org.id)) continue
    seen.add(org.id)
    teams.push({
      id: org.id,
      name: org.name?.trim() || 'Untitled team',
      role: m.role ?? null,
      isPersonal: Boolean(org.is_personal),
    })
  }
  const rows = projects
    .map((p) => ({
      id: p.id,
      name: p.name?.trim() || 'Untitled project',
      organizationId: p.organization_id ?? null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
  return { teams, projects: rows }
}

export function registerWorkspaceNavMetaRoutes(
  app: Hono<{ Variables: Variables }>,
  // Injectable so the fan-out can be tested without a real Supabase session.
  auth: MiddlewareHandler = jwtAuth,
): void {
  // GET /v1/admin/workspace/projects — the cross-team project directory.
  // Deliberately ignores X-Mushi-Org-Id / X-Mushi-Project-Id: its whole job
  // is to answer before the console knows which team is right. Two cheap
  // reads, no per-project counts (unlike /v1/admin/projects).
  app.get('/v1/admin/workspace/projects', auth, async (c) => {
    const userId = c.get('userId') as string
    const db = getServiceClient()
    let ids: string[]
    try {
      ids = await accessibleProjectIds(db, userId, { strict: true })
    } catch (err) {
      nlog.warn('project_directory_access_failed', { err: String(err) })
      return c.json({ ok: false, error: { code: 'DB_ERROR', message: 'Could not read your projects' } }, 500)
    }
    const [membershipsRes, projectsRes] = await Promise.all([
      db
        .from('organization_members')
        .select('role, organizations!inner(id, name, is_personal)')
        .eq('user_id', userId)
        .order('created_at', { ascending: true }),
      ids.length > 0
        ? db.from('projects').select('id, name, organization_id').in('id', ids)
        : Promise.resolve({ data: [], error: null }),
    ])
    if (membershipsRes.error || projectsRes.error) {
      return c.json({ ok: false, error: { code: 'DB_ERROR', message: 'Could not read your projects' } }, 500)
    }
    return c.json({
      ok: true,
      data: buildProjectDirectory(membershipsRes.data ?? [], projectsRes.data ?? []),
    })
  })

  app.get(NAV_META_PATH, auth, async (c) => {
    const startedAt = Date.now()
    const userId = (c.get('userId') as string | undefined) ?? null
    const verifiedUser: TrustedUser | null = userId
      ? { id: userId, email: (c.get('userEmail') as string | undefined) ?? null }
      : null
    const dispatch = inProcessDispatcher(app, c.req.url, verifiedUser)
    const authHeader = c.req.header('Authorization') ?? ''
    const projectId = c.req.header('X-Mushi-Project-Id') ?? c.req.header('x-mushi-project-id')
    const orgId = c.req.header('X-Mushi-Org-Id') ?? c.req.header('x-mushi-org-id')
    const include = parseNavMetaInclude(c.req.query('include'))
    const wanted = parseNavMetaSlices(c.req.query('slices'))
    const fresh = c.req.query('fresh') === '1'

    // Cache only for a verified user: the key must name whose data this is.
    // `include` is part of the key so a counts-less answer never satisfies a
    // request that asked for counts.
    const cacheKey = userId
      ? [
          userId,
          orgId ?? '',
          projectId ?? '',
          [...include].sort().join('+'),
          wanted ? [...wanted].sort().join('+') : '*',
        ].join('|')
      : null
    if (cacheKey && !fresh) {
      const cached = readCache(cacheKey, startedAt)
      if (cached) {
        return c.json({
          ok: true,
          data: { ...cached, servedFromCache: true, totalMs: Date.now() - startedAt },
        })
      }
    }

    const headerInit: Record<string, string> = {
      Authorization: authHeader,
      'Content-Type': 'application/json',
      ...(projectId ? { 'X-Mushi-Project-Id': projectId } : {}),
      ...(orgId ? { 'X-Mushi-Org-Id': orgId } : {}),
    }

    // Slice key → the stats route that answers it. `?slices=a,b` limits the
    // fan-out to what the caller renders (the Quick and Beginner sidebars
    // show ~10 badges, not 45); no `slices` param means every slice, which
    // keeps older console builds working.
    const sliceRoutes: Array<[NavMetaSliceKey, string | null]> = [
      ['contentQuality', '/v1/admin/content-quality/stats'],
      ['codeHealth', '/v1/admin/code-health/stats'],
      ['experiments', '/v1/admin/experiments/stats'],
      ['lessons', '/v1/admin/lessons/stats'],
      ['drift', '/v1/admin/drift/stats'],
      ['anomalies', '/v1/admin/anomalies/stats'],
      ['iterate', '/v1/admin/pdca/stats'],
      ['onboarding', '/v1/admin/onboarding/stats'],
      ['rewards', '/v1/admin/rewards/stats'],
      ['billing', '/v1/admin/billing/stats'],
      ['audit', '/v1/admin/audit/stats'],
      ['intelligence', '/v1/admin/intelligence/stats'],
      ['releases', '/v1/admin/releases/stats'],
      ['fullstackAudit', '/v1/admin/fullstack-audit/stats'],
      ['dashboard', '/v1/admin/dashboard/stats'],
      ['explore', '/v1/admin/explore/stats'],
      ['promptLab', '/v1/admin/prompt-lab/stats'],
      ['research', '/v1/admin/research/stats'],
      ['graph', '/v1/admin/graph/stats'],
      ['inventory', '/v1/admin/inventory/stats'],
      ['health', '/v1/admin/health/stats'],
      ['fixes', '/v1/admin/fixes/stats'],
      ['repo', '/v1/admin/repo/stats'],
      ['mcp', '/v1/admin/mcp/stats'],
      ['marketplace', '/v1/admin/marketplace/stats'],
      ['settings', '/v1/admin/settings/stats'],
      ['sso', '/v1/admin/sso/stats'],
      ['compliance', '/v1/admin/compliance/stats'],
      ['storage', '/v1/admin/storage/stats'],
      ['query', '/v1/admin/query/stats'],
      ['integrations', '/v1/admin/integrations/stats'],
      ['featureBoard', '/v1/admin/feature-board/stats'],
      ['skills', '/v1/admin/skills/stats'],
      ['qaCoverage', projectId ? `/v1/admin/projects/${encodeURIComponent(projectId)}/qa-coverage/stats` : null],
      ['costs', projectId ? `/v1/admin/costs/stats?project_id=${encodeURIComponent(projectId)}` : null],
      ['projects', '/v1/admin/projects/stats'],
      ['members', orgId ? `/v1/org/${encodeURIComponent(orgId)}/members/stats` : null],
    ]
    const paths: string[] = sliceRoutes
      .filter(([key, path]) => path !== null && (!wanted || wanted.has(key)))
      .map(([, path]) => path as string)

    // Sidebar per-item counters, answered by the same routes the console
    // used to call one by one.
    const countPaths = {
      fixesSummary: '/v1/admin/fixes/summary',
      untriagedReports: '/v1/admin/reports?status=new&limit=1',
      notifications: '/v1/admin/notifications?unread=1&count_only=1',
      queue: '/v1/admin/queue/summary',
      flaggedDevices: '/v1/admin/anti-gaming/devices?flagged=true&count_only=1',
      feedback: '/v1/admin/support/tickets/summary',
      judge: '/v1/admin/judge/stats',
      inbox: '/v1/admin/inbox/stats',
      inventory: projectId ? `/v1/admin/inventory/${encodeURIComponent(projectId)}` : null,
      superAdmin: '/v1/super-admin/metrics',
    }
    if (include.has('counts')) {
      paths.push(
        countPaths.fixesSummary,
        countPaths.untriagedReports,
        countPaths.notifications,
        countPaths.queue,
        countPaths.flaggedDevices,
        countPaths.feedback,
        countPaths.judge,
        countPaths.inbox,
      )
      if (include.has('inventory') && countPaths.inventory) paths.push(countPaths.inventory)
      if (include.has('superadmin')) paths.push(countPaths.superAdmin)
    }

    const timingsMs: Record<string, number> = {}
    const runAll = () =>
      Promise.all(
        paths.map(async (path) => {
          const t0 = Date.now()
          const result = await fetchStatsSlice(dispatch, path, new Headers(headerInit))
          timingsMs[path] = Date.now() - t0
          return result
        }),
      )
    const results = userId ? await withFanoutMemo(userId, runAll) : await runAll()

    const byPath = Object.fromEntries(paths.map((path, i) => [path, results[i].data]))
    // A missing badge must be explainable: name every slice that failed.
    const failedSlices = paths
      .map((path, i) => (results[i].error ? { path, error: results[i].error } : null))
      .filter((x): x is { path: string; error: string } => x !== null)

    const slices = {
      contentQuality: pick(byPath['/v1/admin/content-quality/stats'], [
        'openCount',
        'inReviewCount',
        'regeneratingCount',
        'userFlagOpenCount',
        'failedRegenCount',
        'needsAttentionCount',
        'topPriority',
      ]),
      codeHealth: pick(byPath['/v1/admin/code-health/stats'], [
        'errorCount',
        'warnCount',
        'godFileCount',
        'hasRun',
        'topPriority',
      ]),
      qaCoverage: projectId
        ? pick(byPath[`/v1/admin/projects/${projectId}/qa-coverage/stats`], [
            'totalStories',
            'failingStories',
            'pendingRuns',
            'topPriority',
          ])
        : null,
      experiments: pick(byPath['/v1/admin/experiments/stats'], [
        'totalExperiments',
        'runningCount',
        'draftsReadyToLaunch',
        'winnersFound',
        'topPriority',
      ]),
      lessons: pick(byPath['/v1/admin/lessons/stats'], [
        'activeLessons',
        'readyToPromote',
        'criticalLessons',
        'topPriority',
      ]),
      drift: pick(byPath['/v1/admin/drift/stats'], [
        'openFindings',
        'criticalOpen',
        'topPriority',
      ]),
      anomalies: pick(byPath['/v1/admin/anomalies/stats'], [
        'openAnomalies',
        'releaseRegressionOpen',
        'topPriority',
      ]),
      iterate: pick(byPath['/v1/admin/pdca/stats'], [
        'total',
        'failed',
        'queued',
        'running',
        'topPriority',
      ]),
      onboarding: pick(byPath['/v1/admin/onboarding/stats'], [
        'setupDone',
        'requiredComplete',
        'requiredTotal',
        'sdkHostMismatch',
      ]),
      rewards: pick(byPath['/v1/admin/rewards/stats'], [
        'openDisputesCount',
        'webhooksFailing',
        'activeContributors30d',
        'topPriority',
      ]),
      billing: pick(byPath['/v1/admin/billing/stats'], [
        'pastDueProjects',
        'overQuota',
        'approachingQuota',
        'unpaidProjects',
      ]),
      audit: (() => {
        const audit = byPath['/v1/admin/audit/stats']
        if (!audit) return null
        return {
          warnCount24h: Number(audit.warnCount24h ?? 0),
          failCount24h: Number(audit.failCount24h ?? 0),
          events24h: Number(audit.events24h ?? 0),
        }
      })(),
      intelligence: pick(byPath['/v1/admin/intelligence/stats'], [
        'pendingFindings',
        'failedJobCount',
        'activeJobCount',
        'reportCount',
        'topPriority',
      ]),
      releases: pick(byPath['/v1/admin/releases/stats'], [
        'draftCount',
        'creditsPending',
        'totalReleases',
        'topPriority',
      ]),
      fullstackAudit: pick(byPath['/v1/admin/fullstack-audit/stats'], [
        'errorCount',
        'warnCount',
        'failedGateCount',
        'topPriority',
      ]),
      dashboard: pick(byPath['/v1/admin/dashboard/stats'], [
        'openBacklog',
        'fixesFailed',
        'fixesInProgress',
        'integrationIssues',
        'topPriority',
      ]),
      explore: pick(byPath['/v1/admin/explore/stats'], [
        'indexedFiles',
        'lastIndexError',
        'topPriority',
      ]),
      promptLab: pick(byPath['/v1/admin/prompt-lab/stats'], [
        'untestedAbCount',
        'promoteReadyCount',
        'abTestingCount',
        'totalPrompts',
        'topPriority',
      ]),
      research: pick(byPath['/v1/admin/research/stats'], [
        'unattachedSnippets',
        'firecrawlReady',
        'firecrawlTestStatus',
        'sessions',
        'topPriority',
      ]),
      graph: pick(byPath['/v1/admin/graph/stats'], [
        'regressionEdges',
        'fragileComponents',
        'nodeCount',
        'topPriority',
      ]),
      inventory: pick(byPath['/v1/admin/inventory/stats'], [
        'regressed',
        'openFindings',
        'stub',
        'total',
        'topPriority',
      ]),
      health: pick(byPath['/v1/admin/health/stats'], [
        'cronErrorCount',
        'redCount',
        'amberCount',
        'topPriority',
      ]),
      fixes: pick(byPath['/v1/admin/fixes/stats'], [
        'failed',
        'inProgress',
        'specWarnings',
        'topPriority',
      ]),
      repo: pick(byPath['/v1/admin/repo/stats'], ['prOpen', 'ciFailed', 'topPriority']),
      mcp: pick(byPath['/v1/admin/mcp/stats'], [
        'mcpReadKeyCount',
        'neverConnectedCount',
        'endpointMismatch',
        'reportOnlyKeyCount',
        'topPriority',
      ]),
      marketplace: pick(byPath['/v1/admin/marketplace/stats'], [
        'failingPlugins',
        'neverDeliveredPlugins',
        'installedActive',
        'deliveriesFailed',
        'topPriority',
      ]),
      settings: pick(byPath['/v1/admin/settings/stats'], [
        'byokKeysFailing',
        'byokKeysUntested',
        'byokKeysConfigured',
        'slackConfigured',
        'githubRepoConfigured',
      ]),
      costs: projectId
        ? pick(byPath[`/v1/admin/costs/stats?project_id=${encodeURIComponent(projectId)}`], [
            'spendSpike24h',
            'failedCalls24h',
            'calls24h',
            'spend24hUsd',
          ])
        : null,
      sso: pick(byPath['/v1/admin/sso/stats'], [
        'failedCount',
        'pendingCount',
        'manualRequiredCount',
        'ssoEntitlement',
      ]),
      compliance: pick(byPath['/v1/admin/compliance/stats'], [
        'controlsFail',
        'controlsWarn',
        'overdueDsars',
        'atRiskDsars',
        'soc2Entitlement',
      ]),
      storage: pick(byPath['/v1/admin/storage/stats'], [
        'failingCount',
        'degradedCount',
        'neverProbedCount',
        'activeProjectHealthStatus',
      ]),
      query: pick(byPath['/v1/admin/query/stats'], [
        'errors24h',
        'runs24h',
        'savedCount',
        'schemaDegraded',
      ]),
      integrations: pick(byPath['/v1/admin/integrations/stats'], [
        'platformDown',
        'platformConnected',
        'platformTotal',
        'routingPaused',
      ]),
      featureBoard: pick(byPath['/v1/admin/feature-board/stats'], [
        'openCount',
        'shippedCount',
        'totalVotes',
        'trendingCount',
      ]),
      skills: pick(byPath['/v1/admin/skills/stats'], [
        'catalogTotal',
        'activeRuns',
        'failedRuns',
        'awaitingCheckin',
      ]),
    }

    const projectsStats = byPath['/v1/admin/projects/stats']
    const membersStats = orgId ? byPath[`/v1/org/${orgId}/members/stats`] : null

    // null = that counter's route failed or was not asked for; the console
    // shows no badge instead of a made-up zero.
    let counts: JsonRecord | null = null
    if (include.has('counts')) {
      const at = (path: string | null) => (path ? byPath[path] ?? null : null)
      const fixes = at(countPaths.fixesSummary)
      const reports = at(countPaths.untriagedReports)
      const notifications = at(countPaths.notifications)
      const queueByStatus = (at(countPaths.queue)?.byStatus ?? null) as JsonRecord | null
      const flagged = at(countPaths.flaggedDevices)
      const feedback = at(countPaths.feedback)
      const judge = at(countPaths.judge)
      const inbox = at(countPaths.inbox)
      const inventorySummary = include.has('inventory')
        ? ((at(countPaths.inventory)?.summary ?? null) as JsonRecord | null)
        : null
      const superAdmin = include.has('superadmin') ? at(countPaths.superAdmin) : null
      counts = {
        fixesInFlight: fixes ? num(fixes.inProgress) ?? 0 : null,
        fixesFailed: fixes ? num(fixes.failed) ?? 0 : null,
        prsOpen: fixes ? num(fixes.prsOpen) ?? 0 : null,
        untriagedBacklog: reports ? num(reports.total) ?? 0 : null,
        notificationsUnread: notifications ? num(notifications.unread_count) ?? 0 : null,
        queueFailed: queueByStatus
          ? (num(queueByStatus.dead_letter) ?? 0) + (num(queueByStatus.failed) ?? 0)
          : null,
        flaggedDevices: flagged ? num(flagged.count) ?? 0 : null,
        feedbackWithReply: feedback ? num(feedback.with_reply) ?? 0 : null,
        judgeDisagreements: judge ? num(judge.disagreementCount) ?? 0 : null,
        inboxOpenActions: inbox ? num(inbox.openActions) ?? 0 : null,
        regressedActions: inventorySummary ? num(inventorySummary.regressed) : null,
        superAdminSignups7d: superAdmin ? num(superAdmin.signups_last_7d) : null,
        superAdminChurn30d: superAdmin ? num(superAdmin.churn_last_30d) : null,
      }
    }

    const data: JsonRecord = {
      generatedAt: new Date().toISOString(),
      slices,
      counts,
      failedSlices,
      timingsMs,
      projects: projectsStats
        ? {
            projectCount: Number(projectsStats.projectCount ?? 0),
            neverIngestedCount: Number(projectsStats.neverIngestedCount ?? 0),
            staleKeyCount: Number(projectsStats.staleKeyCount ?? 0),
          }
        : null,
      members: membersStats
        ? {
            memberCount:
              membersStats.memberCount != null ? Number(membersStats.memberCount) : null,
            pendingInvites: Number(membersStats.pendingInvites ?? 0),
            inactiveCount: Number(membersStats.inactiveCount ?? 0),
            atSeatCap: Boolean(membersStats.atSeatCap),
            expiringSoonInvites: Number(membersStats.expiringSoonInvites ?? 0),
          }
        : null,
    }
    if (cacheKey) writeCache(cacheKey, data, Date.now())
    return c.json({
      ok: true,
      data: { ...data, servedFromCache: false, totalMs: Date.now() - startedAt },
    })
  })
}
