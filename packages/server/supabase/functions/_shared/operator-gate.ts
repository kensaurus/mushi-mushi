/**
 * FILE: packages/server/supabase/functions/_shared/operator-gate.ts
 * PURPOSE: Operator (founder) gate for company-level analytics surfaces —
 *          GET /v1/admin/growth/funnel and the setup-funnel counts panel on
 *          GET /v1/admin/setup.
 *
 * Reads secret MUSHI_OPERATOR_USER_IDS (comma-separated auth.users ids).
 * Kept separate from the `super_admin` JWT role on purpose: that role is a
 * DB-promoted cross-tenant directory permission, whereas the operator list is
 * a deploy-time secret the founders own without a migration, and it mirrors
 * public.operator_users — the exclusion list company_funnel_weekly() reads so
 * founders' own signups/projects never inflate the funnel.
 *
 * Fail closed: unset or empty secret → nobody is an operator.
 */

import type { Context } from 'npm:hono@4'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function operatorIds(): Set<string> {
  const raw = Deno.env.get('MUSHI_OPERATOR_USER_IDS') ?? ''
  return new Set(
    raw
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter((s) => UUID_RE.test(s)),
  )
}

/** True when the console user id is listed in MUSHI_OPERATOR_USER_IDS. */
export function isOperatorUser(userId: string | null | undefined): boolean {
  if (!userId) return false
  return operatorIds().has(userId.toLowerCase())
}

/**
 * Route guard for jwtAuth handlers. Returns a 403 Response for non-operators
 * and null when the caller may proceed:
 *
 *   const denied = requireOperator(c); if (denied) return denied;
 */
export function requireOperator(c: Context): Response | null {
  const userId = c.get('userId') as string | undefined
  if (isOperatorUser(userId)) return null
  return c.json({ ok: false, error: { code: 'FORBIDDEN', message: 'operator only' } }, 403)
}
