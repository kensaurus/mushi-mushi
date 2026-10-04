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

// `ok: false` matters: the console's envelope reader treats a body without it
// as a success and showed the raw JSON (`403: {"error":...} (HTTP_ERROR)`).
const FORBIDDEN_MESSAGE =
  'You do not have access to this project. Pick another project in the header switcher, or ask a team admin to add you.'

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

  const authMethod = c.get('authMethod') as string | undefined
  if (authMethod === 'apiKey') {
    const bound = c.get('projectId') as string | undefined
    if (!bound || projectId !== bound) {
      return c.json({ ok: false, error: { code: 'FORBIDDEN', message: FORBIDDEN_MESSAGE } }, 403)
    }
    return next()
  }

  const userId = c.get('userId')
  if (!userId) {
    return c.json({ ok: false, error: { code: 'UNAUTHENTICATED', message: 'Sign in again to continue.' } }, 401)
  }

  const db = getServiceClient()
  const allowed = await accessibleProjectIds(db, userId)
  if (!allowed.includes(projectId)) {
    return c.json({ ok: false, error: { code: 'FORBIDDEN', message: FORBIDDEN_MESSAGE } }, 403)
  }

  return next()
}
