/**
 * FILE: packages/server/supabase/functions/api/routes/byok-cursor-models.ts
 * PURPOSE: GET /v1/admin/byok/cursor/models — Cursor's model list for the
 *          spend-down and Integrations pickers (BL-090).
 *
 *          Calls Cursor GET /v1/models. `?keyId=` uses that byok key (the
 *          spend-down form, one account per key). With no keyId, uses the
 *          key the app would use (Integrations), including a legacy
 *          Integrations key. The saved value stays a spec that
 *          parseCursorModelSpec accepts. jwtAuth: console only.
 */

import type { Context, Hono } from 'npm:hono@4'
import type { Variables } from '../types.ts'
import { getServiceClient } from '../../_shared/db.ts'
import { jwtAuth } from '../../_shared/auth.ts'
import { dbError, resolveOwnedProject } from '../shared.ts'
import { byokKeyIdSchema } from '../../_shared/byok-validation.ts'
import { keyOwnerFilter } from '../../_shared/byok-scope.ts'
import { resolveCursorApiKey } from '../../_shared/agent-adapters.ts'
import { CursorApiError, listCursorModelsV1 } from '../../_shared/cursor-cloud.ts'
import { log } from '../../_shared/logger.ts'

const mlog = log.child('byok-cursor-models')

function bad(c: Context, code: string, message: string, status: 400 | 404 = 400) {
  return c.json({ ok: false, error: { code, message } }, status)
}

async function sendModels(c: Context, apiKey: string) {
  try {
    const models = await listCursorModelsV1({ apiKey })
    return c.json({ ok: true, data: { models } })
  } catch (err) {
    const status = err instanceof CursorApiError ? err.status : 0
    mlog.warn('cursor model list failed', {
      status,
      err: (err instanceof Error ? err.message : String(err)).slice(0, 200),
    })
    return c.json(
      {
        ok: false,
        error: {
          code: 'CURSOR_MODELS_FAILED',
          message: `Cursor did not return its models (${status || 'network'}). Check the key under Settings → AI keys.`,
        },
      },
      502,
    )
  }
}

export function registerByokCursorModelsRoutes(app: Hono<{ Variables: Variables }>): void {
  app.get('/v1/admin/byok/cursor/models', jwtAuth, async (c) => {
    const userId = c.get('userId') as string
    const db = getServiceClient()
    const resolved = await resolveOwnedProject(c, db, userId, {
      noProjectResponse: () => bad(c, 'NO_PROJECT', 'No project selected'),
    })
    if ('response' in resolved) return resolved.response
    const project = resolved.project
    const keyId = c.req.query('keyId')?.trim() ?? ''

    if (!keyId) {
      const apiKey = await resolveCursorApiKey(db, project.id)
      if (!apiKey)
        return bad(c, 'NO_CURSOR_KEY', 'Add a Cursor API key under Settings → AI keys first.')
      return sendModels(c, apiKey)
    }
    if (!byokKeyIdSchema.safeParse(keyId).success)
      return bad(c, 'INVALID_KEY_ID', 'keyId must be a UUID.')

    const orgId = (project.organization_id as string | null) ?? null
    const { data: key, error } = await db
      .from('byok_keys')
      .select('id, provider_slug, vault_secret_id')
      .eq('id', keyId)
      .or(keyOwnerFilter({ projectId: project.id, organizationId: orgId }))
      .maybeSingle()
    if (error) return dbError(c, error)
    if (!key) return bad(c, 'NOT_FOUND', 'No such key for this app.', 404)
    if (key.provider_slug !== 'cursor')
      return bad(c, 'NOT_CURSOR_KEY', 'Model list is for Cursor keys only.')
    if (!key.vault_secret_id)
      return bad(c, 'NO_CURSOR_KEY', 'This Cursor key has no secret stored.')

    const { data: secret, error: secretErr } = await db.rpc('vault_get_secret', {
      secret_id: key.vault_secret_id,
    })
    if (secretErr || typeof secret !== 'string' || secret.length === 0) {
      return bad(c, 'NO_CURSOR_KEY', 'This Cursor key has no secret stored.')
    }
    return sendModels(c, secret)
  })
}
