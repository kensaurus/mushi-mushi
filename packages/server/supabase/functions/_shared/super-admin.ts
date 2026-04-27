// ============================================================
// Super-admin role gate.
//
// Why this exists: the operator (kensaurus@gmail.com) needs to see every
// signup, plan, and activity number across all tenants. The existing
// admin endpoints all scope by `projects.owner_id = userId` — they can
// never read another tenant's rows. So we need a separate route family
// (`/v1/super-admin/*`) gated by an explicit role marker, NOT by JWT
// alone (a valid JWT only proves "you signed up", not "you are the
// operator").
//
// Storage: the role lives in `auth.users.raw_app_meta_data.role`
// (set by the 20260427_super_admin_role.sql migration). `app_metadata`
// is the right slot — it's read-only from the client (auth-js refuses
// `updateUser({ app_metadata })`) and is the canonical place to put
// authorization claims that aren't user-editable.
//
// Failure mode: 403 with an opaque error (no leak of "this endpoint
// exists") so scanners that probe `/v1/super-admin/*` can't tell a
// real route from a 404. The middleware also logs every blocked
// attempt — operator visibility on attempted privilege escalation.
// ============================================================
import type { Context, Next } from 'npm:hono@4'
import { getServiceClient } from './db.ts'
import { log } from './logger.ts'

export const SUPER_ADMIN_ROLE = 'super_admin'

/**
 * Resolve `app_metadata.role` for the authenticated user. Returns
 * `null` for any error (missing user, GoTrue timeout, malformed
 * claim) — callers translate that to a 403, never to a 500.
 */
export async function getUserRole(userId: string): Promise<string | null> {
  const db = getServiceClient()
  try {
    const { data, error } = await db.auth.admin.getUserById(userId)
    if (error || !data?.user) return null
    const role = (data.user.app_metadata as Record<string, unknown> | null)?.role
    return typeof role === 'string' ? role : null
  } catch (err) {
    log.warn('super_admin_role_lookup_failed', {
      userId,
      err: err instanceof Error ? err.message : String(err),
    })
    return null
  }
}

/**
 * Middleware: gate a route to super-admin callers only.
 *
 * Must run AFTER `jwtAuth` (or `adminOrApiKey`) so `userId` is set.
 * Returns 403 with an opaque body when the caller isn't a super-admin
 * — no leak of "this endpoint exists". Logs every block at info level
 * so we can spot probing.
 */
export async function requireSuperAdmin(c: Context, next: Next) {
  const userId = c.get('userId') as string | undefined
  if (!userId) {
    return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Not found.' } }, 404)
  }

  const role = await getUserRole(userId)
  if (role !== SUPER_ADMIN_ROLE) {
    log.info('super_admin_blocked', {
      userId,
      path: c.req.path,
      method: c.req.method,
      role: role ?? 'user',
    })
    // Opaque 404 — same response the gateway returns for unknown routes,
    // so scanners can't infer this surface exists from the status code.
    return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Not found.' } }, 404)
  }

  c.set('isSuperAdmin', true)
  await next()
}
