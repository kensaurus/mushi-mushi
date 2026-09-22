/**
 * FILE: packages/server/supabase/functions/api/routes/growth.ts
 * PURPOSE: GET /v1/admin/growth/funnel — Mushi's own company funnel
 *          (visits → signups → projects → keys → sdk_installed → activated →
 *          fix_pulled → habit → paid) per ISO week, plus signups/activated
 *          by signup_source. Operator-only.
 *
 * Backed by public.company_funnel_weekly(p_weeks, p_source), which excludes
 * public.operator_users from every count and reads the self project id from
 * mushi_runtime_config.self_project_id. The RPC is service_role-only; this
 * route is its only caller and gates on requireOperator
 * (secret MUSHI_OPERATOR_USER_IDS) before touching the DB.
 */

import type { Hono } from 'npm:hono@4';
import type { Variables } from '../types.ts';
import { jwtAuth } from '../../_shared/auth.ts';
import { getServiceClient } from '../../_shared/db.ts';
import { log } from '../../_shared/logger.ts';
import { requireOperator } from '../../_shared/operator-gate.ts';

const DEFAULT_WEEKS = 8;
const MAX_WEEKS = 52;
/** signup_source values are short identifiers (utm-ish); anything else is rejected. */
const SOURCE_RE = /^[a-z0-9][a-z0-9_.:-]{0,63}$/i;

interface FunnelPayload {
  weeks?: unknown;
  by_source?: unknown;
  window_start?: unknown;
  window_end?: unknown;
  source?: unknown;
  self_project_configured?: unknown;
}

export function registerGrowthRoutes(app: Hono<{ Variables: Variables }>): void {
  // GET /v1/admin/growth/funnel?weeks=8&source=<signup_source|all>
  app.get('/v1/admin/growth/funnel', jwtAuth, async (c) => {
    const denied = requireOperator(c);
    if (denied) return denied;

    let weeks = DEFAULT_WEEKS;
    const weeksRaw = c.req.query('weeks');
    if (weeksRaw !== undefined && weeksRaw !== '') {
      const n = Number.parseInt(weeksRaw, 10);
      if (!Number.isInteger(n) || n < 1 || n > MAX_WEEKS) {
        return c.json(
          {
            ok: false,
            error: { code: 'INVALID_INPUT', message: `weeks must be an integer between 1 and ${MAX_WEEKS}` },
          },
          400,
        );
      }
      weeks = n;
    }

    const sourceRaw = (c.req.query('source') ?? 'all').trim();
    if (sourceRaw !== 'all' && !SOURCE_RE.test(sourceRaw)) {
      return c.json(
        { ok: false, error: { code: 'INVALID_INPUT', message: 'source must be a short identifier or "all"' } },
        400,
      );
    }
    const source = sourceRaw === 'all' ? null : sourceRaw;

    const db = getServiceClient();
    const { data, error } = await db.rpc('company_funnel_weekly', { p_weeks: weeks, p_source: source });
    if (error) {
      log.warn('growth: company_funnel_weekly failed', { err: error.message, weeks, source });
      return c.json(
        { ok: false, error: { code: 'FUNNEL_QUERY_FAILED', message: 'Could not compute the growth funnel' } },
        500,
      );
    }

    const payload = (data ?? {}) as FunnelPayload;
    return c.json({
      ok: true,
      data: {
        weeks: Array.isArray(payload.weeks) ? payload.weeks : [],
        by_source: Array.isArray(payload.by_source) ? payload.by_source : [],
        window_start: typeof payload.window_start === 'string' ? payload.window_start : null,
        window_end: typeof payload.window_end === 'string' ? payload.window_end : null,
        source: source ?? 'all',
        self_project_configured: payload.self_project_configured === true,
        generated_at: new Date().toISOString(),
      },
    });
  });
}
