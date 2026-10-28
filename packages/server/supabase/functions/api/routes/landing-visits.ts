/**
 * FILE: packages/server/supabase/functions/api/routes/landing-visits.ts
 * PURPOSE: The cookieless landing page-view count and the daily GTM
 *          scorecard (November GTM plan §6.1). Served by `api-ext`.
 *
 *   POST /v1/public/page-view   the docs site's beacon `{ path, src?, ref? }`
 *                               (text/plain JSON via navigator.sendBeacon).
 *                               Reaches api-ext only through `api`
 *                               (api/page-view-forward.ts), which hashes the
 *                               visitor IP into the rate-limit bucket header
 *                               and signs the hop with the internal secret.
 *                               Increments one landing_page_views_daily row;
 *                               stores no IP, id, user agent or fingerprint.
 *   GET  /v1/admin/growth/daily  operator-only: page views, signups and
 *                               activated organizations per UTC day and by
 *                               `?src=` / signup source (gtm_daily_scorecard).
 *                               Same auth as GET /v1/admin/growth/funnel.
 */

import type { Hono } from 'npm:hono@4'
import type { Variables } from '../types.ts'
import { adminOrApiKey, requireServiceRoleAuth } from '../../_shared/auth.ts'
import { getServiceClient } from '../../_shared/db.ts'
import { log } from '../../_shared/logger.ts'
import { requireOperator } from '../../_shared/operator-gate.ts'
import {
  PAGE_VIEW_SCOPE,
  PAGE_VIEWS_PER_MINUTE,
  VISITOR_BUCKET_HEADER,
  isBotUserAgent,
  parsePageViewBody,
} from '../../_shared/landing-visits.ts'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DEFAULT_DAYS = 14
const MAX_DAYS = 90

export function registerLandingVisitRoutes(app: Hono<{ Variables: Variables }>): void {
  app.post('/v1/public/page-view', async (c) => {
    const denied = requireServiceRoleAuth(c.req.raw)
    if (denied) return denied
    const bucket = c.req.header(VISITOR_BUCKET_HEADER) ?? ''
    if (!UUID_RE.test(bucket)) return c.body(null, 400)
    // Crawlers and headless browsers are not visitors; answered as accepted
    // so a bot learns nothing from the status.
    if (isBotUserAgent(c.req.header('user-agent'))) return c.body(null, 204)
    const view = parsePageViewBody(await c.req.text())
    if (!view) return c.body(null, 400)

    const db = getServiceClient()
    const { error: limitErr } = await db.rpc('scoped_rate_limit_claim', {
      p_user_id: bucket,
      p_scope: PAGE_VIEW_SCOPE,
      p_max_per_window: PAGE_VIEWS_PER_MINUTE,
      p_window: '1 minute',
    })
    if (limitErr) {
      if ((limitErr.message ?? '').includes('rate_limit_exceeded')) return c.body(null, 429)
      // Fail closed: a count that cannot be limited is not recorded.
      log.warn('page-view: rate limit check failed; view not recorded', { err: limitErr.message })
      return c.body(null, 503)
    }

    const { error } = await db.rpc('record_landing_page_view', {
      p_path: view.path,
      p_src: view.src,
      p_referrer_host: view.referrerHost,
    })
    if (error) {
      log.warn('page-view: record failed', { err: error.message })
      return c.body(null, 500)
    }
    return c.body(null, 204)
  })

  // GET /v1/admin/growth/daily?days=14
  app.get('/v1/admin/growth/daily', adminOrApiKey({ scope: 'mcp:read' }), async (c) => {
    if (c.get('authMethod') === 'apiKey' && !c.get('isOrgScopedKey')) {
      return c.json(
        {
          ok: false,
          error: {
            code: 'GROWTH_NEEDS_ACCOUNT_KEY',
            message:
              'This key is bound to one project. The company scorecard needs an account-level key (Connect → MCP → account key) or a signed-in session.',
          },
        },
        403,
      )
    }
    if (c.get('authMethod') === 'apiKey' && (c.get('keyAllowedProjectIds') || c.req.header('X-Mushi-Project-Id'))) {
      return c.json(
        {
          ok: false,
          error: {
            code: 'KEY_LIMITED_TO_PROJECTS',
            message: 'This connection is limited to some projects. The company scorecard needs a key with access to all your projects, or a signed-in session.',
          },
        },
        403,
      )
    }
    const denied = requireOperator(c)
    if (denied) return denied

    let days = DEFAULT_DAYS
    const raw = c.req.query('days')
    if (raw !== undefined && raw !== '') {
      const n = Number.parseInt(raw, 10)
      if (!Number.isInteger(n) || n < 1 || n > MAX_DAYS) {
        return c.json(
          { ok: false, error: { code: 'INVALID_INPUT', message: `days must be an integer between 1 and ${MAX_DAYS}` } },
          400,
        )
      }
      days = n
    }

    const db = getServiceClient()
    const { data, error } = await db.rpc('gtm_daily_scorecard', { p_days: days })
    if (error) {
      log.warn('growth: gtm_daily_scorecard failed', { err: error.message, days })
      return c.json(
        { ok: false, error: { code: 'SCORECARD_QUERY_FAILED', message: 'Could not compute the daily scorecard' } },
        500,
      )
    }
    const payload = (data ?? {}) as Record<string, unknown>
    return c.json({
      ok: true,
      data: {
        days: Array.isArray(payload.days) ? payload.days : [],
        by_src: Array.isArray(payload.by_src) ? payload.by_src : [],
        window_start: typeof payload.window_start === 'string' ? payload.window_start : null,
        self_project_configured: payload.self_project_configured === true,
        generated_at: new Date().toISOString(),
      },
    })
  })
}
