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
 *
 * Also the fence for platform-owned credentials that belong to the operator's
 * own accounts (isOperatorProject): the env SLACK_BOT_TOKEN is the operator
 * workspace's bot, so only projects the operator owns may fall back to it.
 */

import type { Context } from 'npm:hono@4'
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

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
 * True when the project's owner is an operator. Fails closed: a missing
 * project, a failed read, or an unset secret all answer false.
 *
 * Use it before falling back to an env credential that belongs to the
 * operator's own third-party account. Without it, the Slack channel picker
 * listed the operator workspace's channels to any tenant project without its
 * own Slack install, and "Send test message" posted into the operator's
 * channel on a tenant's click.
 */
export async function isOperatorProject(
  db: SupabaseClient,
  projectId: string | null | undefined,
): Promise<boolean> {
  if (!projectId) return false
  const { data, error } = await db
    .from('projects')
    .select('owner_id')
    .eq('id', projectId)
    .maybeSingle()
  if (error || !data) return false
  return isOperatorUser((data as { owner_id?: string | null }).owner_id)
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
