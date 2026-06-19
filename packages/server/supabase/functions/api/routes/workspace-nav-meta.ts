/**
 * GET /v1/admin/workspace/nav-meta
 *
 * Consolidates sidebar stat slices into one round trip. Internally fans out
 * to the existing /stats handlers in parallel (same auth + project headers)
 * so badge logic stays single-sourced on each route.
 */

import type { Hono } from 'npm:hono@4'
import { jwtAuth } from '../../_shared/auth.ts'
import { log } from '../../_shared/logger.ts'
import type { Variables } from '../types.ts'

const nlog = log.child('workspace-nav-meta')

type JsonRecord = Record<string, unknown>

async function fetchStatsSlice(
  baseUrl: string,
  path: string,
  headers: HeadersInit,
): Promise<JsonRecord | null> {
  try {
    const res = await fetch(`${baseUrl}${path}`, { headers })
    if (!res.ok) {
      nlog.warn('nav_meta_slice_failed', { path, status: res.status })
      return null
    }
    const body = (await res.json()) as { ok?: boolean; data?: JsonRecord }
    return body.ok ? (body.data ?? null) : null
  } catch (err) {
    nlog.warn('nav_meta_slice_error', {
      path,
      err: err instanceof Error ? err.message : String(err),
    })
    return null
  }
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

export function registerWorkspaceNavMetaRoutes(app: Hono<{ Variables: Variables }>): void {
  app.get('/v1/admin/workspace/nav-meta', jwtAuth, async (c) => {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    if (!supabaseUrl) {
      return c.json(
        { ok: false, error: { code: 'CONFIG', message: 'SUPABASE_URL not configured' } },
        500,
      )
    }

    const baseUrl = `${supabaseUrl}/functions/v1/api`
    const auth = c.req.header('Authorization') ?? ''
    const projectId = c.req.header('X-Mushi-Project-Id') ?? c.req.header('x-mushi-project-id')
    const orgId = c.req.header('X-Mushi-Org-Id') ?? c.req.header('x-mushi-org-id')

    const headers: HeadersInit = {
      Authorization: auth,
      'Content-Type': 'application/json',
      ...(projectId ? { 'X-Mushi-Project-Id': projectId } : {}),
      ...(orgId ? { 'X-Mushi-Org-Id': orgId } : {}),
    }

    const paths = [
      '/v1/admin/content-quality/stats',
      '/v1/admin/code-health/stats',
      '/v1/admin/experiments/stats',
      '/v1/admin/lessons/stats',
      '/v1/admin/drift/stats',
      '/v1/admin/anomalies/stats',
      '/v1/admin/pdca/stats',
      '/v1/admin/onboarding/stats',
      '/v1/admin/rewards/stats',
      '/v1/admin/billing/stats',
      '/v1/admin/audit/stats',
      '/v1/admin/intelligence/stats',
      '/v1/admin/releases/stats',
      '/v1/admin/fullstack-audit/stats',
      '/v1/admin/dashboard/stats',
      '/v1/admin/explore/stats',
      '/v1/admin/prompt-lab/stats',
      '/v1/admin/research/stats',
      '/v1/admin/graph/stats',
      '/v1/admin/inventory/stats',
      '/v1/admin/health/stats',
      '/v1/admin/fixes/stats',
      '/v1/admin/repo/stats',
      '/v1/admin/mcp/stats',
      '/v1/admin/marketplace/stats',
      '/v1/admin/settings/stats',
      '/v1/admin/sso/stats',
      '/v1/admin/compliance/stats',
      '/v1/admin/storage/stats',
      '/v1/admin/query/stats',
      '/v1/admin/integrations/stats',
      '/v1/admin/feature-board/stats',
      '/v1/admin/skills/stats',
      ...(projectId ? [`/v1/admin/projects/${encodeURIComponent(projectId)}/qa-coverage/stats`] : []),
      ...(projectId ? [`/v1/admin/costs/stats?project_id=${encodeURIComponent(projectId)}`] : []),
      '/v1/admin/projects/stats',
      ...(orgId ? [`/v1/org/${encodeURIComponent(orgId)}/members/stats`] : []),
    ] as const

    const results = await Promise.all(
      paths.map((path) => fetchStatsSlice(baseUrl, path, headers)),
    )

    const byPath = Object.fromEntries(paths.map((path, i) => [path, results[i]]))

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

    return c.json({
      ok: true,
      data: {
        generatedAt: new Date().toISOString(),
        slices,
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
      },
    })
  })
}
