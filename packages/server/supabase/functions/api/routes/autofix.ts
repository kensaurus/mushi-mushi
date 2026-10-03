/**
 * autofix.ts — the project's autofix flag.
 *
 *   GET  /v1/admin/projects/:id/autofix          adminOrApiKey(mcp:read)
 *   POST /v1/admin/projects/:id/autofix/toggle   adminOrApiKey(mcp:write), owner or admin
 *
 * Autofix and codebase indexing are the two flags that gate
 * /v1/admin/fixes/dispatch; CodebaseIndexCard (IntegrationsPage) shows both.
 * GET returns the flag and `can_toggle`, so members see the switch disabled
 * with a reason. POST takes `{ enabled: boolean }` (decideAutofixToggle) and
 * is audited. A project-bound key reaches only its own project; any key acts
 * with its owner's real role.
 *
 * Deps are injected so autofix-toggle-contract.test.ts drives these handlers.
 */

import type { Hono, MiddlewareHandler } from 'npm:hono@4'
import { adminOrApiKey } from '../../_shared/auth.ts'
import { logAudit } from '../../_shared/audit.ts'
import { canToggleAutofix, decideAutofixToggle } from '../../_shared/autofix-toggle.ts'
import { getServiceClient } from '../../_shared/db.ts'
import { log } from '../../_shared/logger.ts'
import { callerCanAccessProject, dbError } from '../shared.ts'
import type { Variables } from '../types.ts'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface AutofixRouteDeps {
  getServiceClient: typeof getServiceClient
  adminOrApiKeyRead: MiddlewareHandler
  adminOrApiKeyWrite: MiddlewareHandler
  logAudit: typeof logAudit
}

export const defaultAutofixRouteDeps: AutofixRouteDeps = {
  getServiceClient,
  adminOrApiKeyRead: adminOrApiKey({ scope: 'mcp:read' }) as MiddlewareHandler,
  adminOrApiKeyWrite: adminOrApiKey({ scope: 'mcp:write' }) as MiddlewareHandler,
  logAudit,
}

export function registerAutofixRoutes(
  app: Hono<{ Variables: Variables }>,
  deps: AutofixRouteDeps = defaultAutofixRouteDeps,
): void {
  app.get('/v1/admin/projects/:id/autofix', deps.adminOrApiKeyRead, async (c) => {
    const projectId = c.req.param('id') ?? ''
    const userId = c.get('userId') as string
    const db = deps.getServiceClient()

    if (!UUID_RE.test(projectId)) {
      return c.json({ ok: false, error: { code: 'INVALID_PROJECT_ID', message: 'Project id must be a UUID' } }, 400)
    }

    const access = await callerCanAccessProject(c, db, userId, projectId)
    if (!access.allowed) {
      return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Project not found' } }, 404)
    }

    const { data, error } = await db
      .from('project_settings')
      .select('autofix_enabled')
      .eq('project_id', projectId)
      .maybeSingle()
    if (error) return dbError(c, error)

    return c.json({
      ok: true,
      data: {
        autofix_enabled: Boolean((data as { autofix_enabled?: boolean } | null)?.autofix_enabled),
        can_toggle: canToggleAutofix(access.role),
      },
    })
  })

  app.post('/v1/admin/projects/:id/autofix/toggle', deps.adminOrApiKeyWrite, async (c) => {
    const projectId = c.req.param('id') ?? ''
    const userId = c.get('userId') as string
    const db = deps.getServiceClient()

    if (!UUID_RE.test(projectId)) {
      return c.json({ ok: false, error: { code: 'INVALID_PROJECT_ID', message: 'Project id must be a UUID' } }, 400)
    }

    const access = await callerCanAccessProject(c, db, userId, projectId)
    if (!access.allowed) {
      return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Project not found' } }, 404)
    }

    const body: unknown = await c.req.json().catch(() => null)
    const decision = decideAutofixToggle(access.role, body)
    if (!decision.ok) {
      return c.json({ ok: false, error: { code: decision.code, message: decision.message } }, decision.status)
    }
    const enabled = decision.enabled

    const { error } = await db
      .from('project_settings')
      .upsert({ project_id: projectId, autofix_enabled: enabled }, { onConflict: 'project_id' })
    if (error) return dbError(c, error)

    const via = c.get('authMethod') === 'apiKey' ? 'api_key' : 'console'
    // The flag is already saved, so a failed audit write does not fail the
    // request; it is logged where an operator will see it.
    await deps
      .logAudit(db, projectId, userId, 'settings.updated', 'autofix', projectId, {
        action: 'autofix.toggle',
        enabled,
        via,
      })
      .catch((err: unknown) => {
        log.warn('autofix toggle audit write failed', {
          scope: 'autofix',
          projectId,
          userId,
          via,
          enabled,
          err: err instanceof Error ? err.message : String(err),
        })
      })

    return c.json({ ok: true, data: { autofix_enabled: enabled } })
  })
}
