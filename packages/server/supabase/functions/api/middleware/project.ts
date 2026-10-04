/**
 * Hono middleware: verify the caller can access the requested project.
 *
 * Expects `requireAuth` (or another auth middleware) to have run first, so
 * `userId` / `authMethod` are set on the context. The project is read from
 * the `project_id` query string or the `X-Mushi-Project-Id` header.
 *
 * Two variants, and the choice is made per router on purpose:
 *
 *   - `requireProjectAccess` (strict, the default): a request that names no
 *     project fails closed with 400 PROJECT_REQUIRED. A project-bound API key
 *     names its own project implicitly.
 *
 *   - `checkProjectAccessIfNamed`: verifies the project when one is named and
 *     otherwise lets the request through. It does NOT scope anything by
 *     itself. Every handler behind it must resolve the project it acts on
 *     (from the body, or from the row it reads by id) and check access with
 *     `assertTargetProjectAccess` or `userCanAccessProject`. Routers that use
 *     it, and why:
 *       anomalies, metric-series  body project_id (detect, ingest) and
 *                                 anomaly rows read by id;
 *       drift                     body project_id (scan) and findings by id;
 *       experiments               experiments read by id;
 *       pdca                      body project_id and runs read by id;
 *       skills                    the global skill catalog has no project,
 *                                 pipelines carry body project_id / run id.
 *
 * Until 2026-10 there was only the lenient variant, and three anomaly and
 * metric handlers trusted it to have scoped the request.
 */
import type { Context, MiddlewareHandler, Next } from 'npm:hono@4'
import { getServiceClient } from '../../_shared/db.ts'
import { accessibleProjectIds } from '../../_shared/project-access.ts'
import type { Variables } from '../types.ts'

// `ok: false` matters: the console's envelope reader treats a body without it
// as a success and showed the raw JSON (`403: {"error":...} (HTTP_ERROR)`).
const FORBIDDEN_MESSAGE =
  'You do not have access to this project. Pick another project in the header switcher, or ask a team admin to add you.'

function namedProjectId(c: Context<{ Variables: Variables }>): string | null {
  return (
    c.req.query('project_id') ??
    c.req.header('x-mushi-project-id') ??
    c.req.header('X-Mushi-Project-Id') ??
    null
  )
}

async function verifyProject(
  c: Context<{ Variables: Variables }>,
  next: Next,
  projectId: string,
): Promise<Response | void> {
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

/** Strict: the request must name a project the caller can access. */
export const requireProjectAccess: MiddlewareHandler<{ Variables: Variables }> = async (c, next) => {
  let projectId = namedProjectId(c)
  if (!projectId && c.get('authMethod') === 'apiKey') {
    // A project-bound key always acts on its own project.
    projectId = (c.get('projectId') as string | undefined) ?? null
  }
  if (!projectId) {
    return c.json(
      {
        ok: false,
        error: {
          code: 'PROJECT_REQUIRED',
          message: 'Choose a project first: send project_id or the X-Mushi-Project-Id header.',
        },
      },
      400,
    )
  }
  return verifyProject(c, next, projectId)
}

/**
 * Lenient: checks a named project, passes an unnamed request through. Only
 * for routers whose every handler resolves and checks its own project (see
 * the list in the file header).
 */
export const checkProjectAccessIfNamed: MiddlewareHandler<{ Variables: Variables }> = async (c, next) => {
  const projectId = namedProjectId(c)
  if (!projectId) return next()
  return verifyProject(c, next, projectId)
}
