// evolution.ts — Evolution loop summary endpoints used by the admin dashboard widgets
//
//   GET /v1/admin/projects/:id/privacy-status   (MCP path — project ID in URL)
//   GET /v1/admin/privacy-status                (dashboard path — project from header/query)
//     → PrivacyStatus: byok_configured, storage_provider, region, retention_days, last_audit_at
//     Used by PrivacyPostureBadge in the sidebar and the MCP privacy://status resource.
//
//   GET /v1/admin/projects/:id/evolution-history
//     → EvolutionData: 8-week judge score sparkline, convergence badge
//     Used by EvolutionHistoryWidget on the Dashboard and the MCP evolution://history resource.
//
// Auth: both routes accept JWT auth (dashboard) and API-key auth (MCP / CLI via adminOrApiKey).
// MCP clients send the project ID in X-Mushi-Project; the dashboard uses X-Mushi-Project-Id.

import { Hono } from 'npm:hono@4'
import type { Context } from 'npm:hono@4'
import { adminOrApiKey } from '../../_shared/auth.ts'
import { getServiceClient } from '../../_shared/db.ts'
import { accessibleProjectIds } from '../../_shared/project-access.ts'
import type { Variables } from '../types.ts'

const app = new Hono<{ Variables: Variables }>()

function db() {
  return getServiceClient()
}

// ---------------------------------------------------------------------------
// Shared: build the privacy-status JSON response for a resolved project ID.
// ---------------------------------------------------------------------------
async function buildPrivacyStatus(c: Context<{ Variables: Variables }>, pid: string) {
  const { data: settings, error } = await db()
    .from('project_settings')
    .select(
      'byok_anthropic_key_ref, byok_openai_key_ref, byok_firecrawl_key_ref, ' +
        'byok_browserbase_key_ref, byok_status_checked_at',
    )
    .eq('project_id', pid)
    .maybeSingle()

  if (error) {
    return c.json({ ok: false, error: error.message }, 500)
  }

  const row = settings as Record<string, unknown> | null
  const byokConfigured = row
    ? Boolean(
        row.byok_anthropic_key_ref ||
          row.byok_openai_key_ref ||
          row.byok_firecrawl_key_ref ||
          row.byok_browserbase_key_ref,
      )
    : false

  return c.json({
    ok: true,
    data: {
      byok_configured: byokConfigured,
      storage_provider: 'supabase',
      region: 'ap-southeast-1',
      retention_days: 90,
      last_audit_at: (row?.byok_status_checked_at as string | null) ?? null,
    },
  })
}

// ---------------------------------------------------------------------------
// GET /v1/admin/projects/:id/privacy-status
// MCP-facing route — project ID comes from the URL segment.
// ---------------------------------------------------------------------------
app.get(
  '/v1/admin/projects/:id/privacy-status',
  adminOrApiKey({ scope: 'mcp:read' }),
  async (c) => {
    const userId = c.get('userId') as string
    const pid = c.req.param('id')

    // Authz: API key callers are pinned to the key's own project — they
    // cannot be elevated to another project even if the owner has access.
    // JWT callers fall back to the full accessible-project lookup.
    const apiKeyProjectId = c.get('projectId') as string | undefined
    if (apiKeyProjectId) {
      if (pid !== apiKeyProjectId) {
        return c.json({ ok: false, error: 'forbidden' }, 403)
      }
    } else {
      const projectIds = await accessibleProjectIds(db(), userId)
      if (!projectIds.includes(pid)) {
        return c.json({ ok: false, error: 'forbidden' }, 403)
      }
    }

    return buildPrivacyStatus(c, pid)
  },
)

// ---------------------------------------------------------------------------
// GET /v1/admin/privacy-status
// Dashboard/MCP route — project from query param or header, falling back to
// the first accessible project.  Accepts all project-ID header variants that
// MCP clients and the dashboard use.
// ---------------------------------------------------------------------------
app.get('/v1/admin/privacy-status', adminOrApiKey({ scope: 'mcp:read' }), async (c) => {
  const userId = c.get('userId') as string

  // API key callers: the project is already pinned by the key — do not let
  // query params or headers redirect to a different project.
  const apiKeyProjectId = c.get('projectId') as string | undefined
  if (apiKeyProjectId) {
    return buildPrivacyStatus(c, apiKeyProjectId)
  }

  // JWT callers: resolve a project from query/headers, fall back to first.
  const queryPid =
    c.req.query('project_id') ??
    c.req.header('X-Mushi-Project') ??
    c.req.header('x-mushi-project') ??
    c.req.header('X-Mushi-Project-Id') ??
    c.req.header('x-mushi-project-id') ??
    null

  const projectIds = await accessibleProjectIds(db(), userId)
  if (!projectIds.length) {
    return c.json({ ok: false, error: 'no_projects' }, 404)
  }
  const pid = queryPid && projectIds.includes(queryPid) ? queryPid : projectIds[0]

  return buildPrivacyStatus(c, pid)
})

// ---------------------------------------------------------------------------
// GET /v1/admin/projects/:id/evolution-history
// Returns the last 8 weeks of judge scores + a convergence indicator.
// ---------------------------------------------------------------------------
app.get(
  '/v1/admin/projects/:id/evolution-history',
  adminOrApiKey({ scope: 'mcp:read' }),
  async (c) => {
    const userId = c.get('userId') as string
    const pid = c.req.param('id')

    // Authz: API key callers are pinned to their key's project; JWT callers
    // use the full accessible-project set.
    const apiKeyProjectId = c.get('projectId') as string | undefined
    if (apiKeyProjectId) {
      if (pid !== apiKeyProjectId) {
        return c.json({ ok: false, error: 'forbidden' }, 403)
      }
    } else {
      const projectIds = await accessibleProjectIds(db(), userId)
      if (!projectIds.includes(pid)) {
        return c.json({ ok: false, error: 'forbidden' }, 403)
      }
    }

    const [weekRes, lessonRes, promotionRes] = await Promise.all([
      db().rpc('weekly_judge_scores', { p_project_id: pid, p_weeks: 8 }),
      db()
        .from('lessons')
        .select('id', { count: 'exact', head: true })
        .eq('project_id', pid)
        .is('retired_at', null),
      db()
        .from('prompt_versions')
        .select('id', { count: 'exact', head: true })
        .or(`project_id.is.null,project_id.eq.${pid}`)
        .eq('is_active', true),
    ])

    const weeks = ((weekRes.data ?? []) as Array<{
      week_start: string
      avg_score: number | null
      eval_count: number
    }>)
      .map((w) => ({ week_start: w.week_start, avg_score: w.avg_score, fix_count: w.eval_count }))
      .sort((a, b) => (a.week_start < b.week_start ? 1 : -1))

    // Compute 4-week averages.
    const last4 = weeks.slice(0, 4).map((w) => w.avg_score).filter((s): s is number => s != null)
    const prev4 = weeks.slice(4, 8).map((w) => w.avg_score).filter((s): s is number => s != null)
    const avg_score_last4w = last4.length ? last4.reduce((a, b) => a + b, 0) / last4.length : null
    const avg_score_prev4w = prev4.length ? prev4.reduce((a, b) => a + b, 0) / prev4.length : null

    // "Converging" means the last-4w avg is meaningfully above the prev-4w avg.
    let converging: boolean | null = null
    if (avg_score_last4w != null && avg_score_prev4w != null) {
      converging = avg_score_last4w >= avg_score_prev4w + 0.2
    }

    return c.json({
      ok: true,
      data: {
        weeks: weeks.reverse(), // oldest → newest for the sparkline
        avg_score_last4w,
        avg_score_prev4w,
        converging,
        lesson_count: lessonRes.count ?? 0,
        prompt_promotions_30d: promotionRes.count ?? 0,
      },
    })
  },
)

export function registerEvolutionRoutes(parent: Hono<any>) {
  parent.route('', app)
}
