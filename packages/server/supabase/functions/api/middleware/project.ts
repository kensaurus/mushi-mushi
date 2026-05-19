/**
 * Hono middleware: verify the caller can access the requested project.
 *
 * Expects `requireAuth` to have run first (userId set on context).
 * Reads `project_id` from the query-string or `X-Mushi-Project-Id` header.
 * On success passes through; on failure returns 400/403.
 */
import type { Context, Next } from 'npm:hono@4'
import { getServiceClient } from '../../_shared/db.ts'
import { accessibleProjectIds } from '../../_shared/project-access.ts'
import type { Variables } from '../types.ts'

export async function requireProjectAccess(
  c: Context<{ Variables: Variables }>,
  next: Next,
): Promise<Response | void> {
  const projectId =
    c.req.query('project_id') ??
    c.req.header('x-mushi-project-id') ??
    c.req.header('X-Mushi-Project-Id') ??
    null

  if (!projectId) {
    // No project scoping needed for list routes — let handler decide.
    return next()
  }

  const userId = c.get('userId')
  if (!userId) {
    return c.json({ error: { code: 'UNAUTHENTICATED', message: 'Authentication required' } }, 401)
  }

  const db = getServiceClient()
  const allowed = await accessibleProjectIds(db, userId)
  if (!allowed.includes(projectId)) {
    return c.json({ error: { code: 'FORBIDDEN', message: 'Access to this project is not allowed' } }, 403)
  }

  return next()
}
