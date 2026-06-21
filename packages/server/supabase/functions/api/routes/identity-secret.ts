/**
 * FILE: packages/server/supabase/functions/api/routes/identity-secret.ts
 * PURPOSE: Self-service management of the per-project identity signing secret
 *          used to verify signed end-user tokens (X-Mushi-User-Token).
 *
 * OVERVIEW:
 *   The identity secret is a 32-byte hex key stored in Supabase Vault.
 *   Host apps mint short-lived HS256 JWTs signed with this secret so that
 *   end-user identity is cryptographically verified on report ingest.
 *
 *   Routes:
 *     POST   /v1/admin/projects/:id/identity-secret  → mint + vault + return ONCE
 *     GET    /v1/admin/projects/:id/identity-secret  → status/last-rotated (never raw)
 *     DELETE /v1/admin/projects/:id/identity-secret  → disable (clear ref)
 *
 * SECURITY MODEL:
 *   - Raw secret returned exactly ONCE (on POST/rotate). After that only
 *     the creation timestamp and "configured" boolean are readable.
 *   - Secret stored ONLY in Supabase Vault via vault_store_secret().
 *     `project_settings.assistant_identity_secret_ref` holds only the Vault UUID.
 *   - All endpoints require jwtAuth + canManageProjectSdkConfig ownership gate.
 *   - Rotate: new secret under a new Vault ID, old Vault entry orphaned.
 *
 * DEPENDENCIES:
 *   - _shared/auth.ts   : jwtAuth
 *   - _shared/db.ts     : getServiceClient
 *   - _shared/logger.ts : log
 *   - _shared/audit.ts  : logAudit
 *   - ../helpers.ts     : canManageProjectSdkConfig
 *   - ../shared.ts      : dbError
 */

import type { Hono } from 'npm:hono@4'
import type { Variables } from '../types.ts'
import { getServiceClient } from '../../_shared/db.ts'
import { log as rootLog } from '../../_shared/logger.ts'
import { jwtAuth } from '../../_shared/auth.ts'
import { logAudit } from '../../_shared/audit.ts'
import { canManageProjectSdkConfig } from '../helpers.ts'
import { dbError } from '../shared.ts'

const log = rootLog.child('identity-secret')

/** Mint a cryptographically random 32-byte hex secret. */
function mintIdentitySecret(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export function registerIdentitySecretRoutes(app: Hono<{ Variables: Variables }>): void {
  // ===========================================================
  // POST /v1/admin/projects/:id/identity-secret
  //
  // Mint (or rotate) the identity signing secret for this project.
  // The raw secret is returned ONCE in this response and never again.
  // Idempotent: calling again rotates the secret.
  // ===========================================================
  app.post('/v1/admin/projects/:id/identity-secret', jwtAuth, async (c) => {
    const projectId = c.req.param('id')!
    const userId = c.get('userId') as string
    const db = getServiceClient()

    if (!(await canManageProjectSdkConfig(db, projectId, userId))) {
      return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Project not found' } }, 404)
    }

    const rawSecret = mintIdentitySecret()
    const secretName = `mushi_${projectId}_identity`

    const { error: vaultErr } = await db.rpc('vault_store_secret', {
      secret_name: secretName,
      secret_value: rawSecret,
      p_project_id: projectId,
    })

    if (vaultErr) {
      log.error('vault_store_secret_failed', { projectId, error: vaultErr?.message })
      return c.json({ ok: false, error: { code: 'VAULT_ERROR', message: 'Failed to store secret in Vault' } }, 500)
    }

    // Store the Vault name (not the raw UUID) using the canonical vault:// prefix.
    const vaultRef = `vault://${secretName}`
    const now = new Date().toISOString()
    const { error: updateErr } = await db
      .from('project_settings')
      .upsert(
        {
          project_id: projectId,
          assistant_identity_secret_ref: vaultRef,
          identity_secret_created_at: now,
        },
        { onConflict: 'project_id' },
      )

    if (updateErr) {
      log.error('identity_secret_ref_update_failed', { projectId, error: updateErr.message })
      return dbError(c, updateErr)
    }

    await logAudit(db, projectId, userId, 'settings.updated', 'identity_secret', projectId, {
      action: 'rotated',
    }).catch(() => {})

    log.info('identity_secret_rotated', { projectId })

    return c.json({
      ok: true,
      data: {
        // Raw secret returned ONCE — the client must copy it immediately.
        secret: rawSecret,
        createdAt: now,
        configured: true,
      },
    })
  })

  // ===========================================================
  // GET /v1/admin/projects/:id/identity-secret
  //
  // Returns configuration status + creation timestamp.
  // Never returns the raw secret.
  // ===========================================================
  app.get('/v1/admin/projects/:id/identity-secret', jwtAuth, async (c) => {
    const projectId = c.req.param('id')!
    const userId = c.get('userId') as string
    const db = getServiceClient()

    if (!(await canManageProjectSdkConfig(db, projectId, userId))) {
      return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Project not found' } }, 404)
    }

    const { data, error } = await db
      .from('project_settings')
      .select('assistant_identity_secret_ref, identity_secret_created_at')
      .eq('project_id', projectId)
      .maybeSingle()

    if (error) return dbError(c, error)

    const row = (data ?? {}) as Record<string, unknown>
    const configured =
      typeof row.assistant_identity_secret_ref === 'string' &&
      row.assistant_identity_secret_ref.length > 0

    return c.json({
      ok: true,
      data: {
        configured,
        createdAt: configured ? ((row.identity_secret_created_at as string | null) ?? null) : null,
      },
    })
  })

  // ===========================================================
  // DELETE /v1/admin/projects/:id/identity-secret
  //
  // Disable signed identity for this project by clearing the Vault ref.
  // Identity tokens stop verifying immediately. Reports still ingest but
  // without verified identity (fail-open design).
  // ===========================================================
  app.delete('/v1/admin/projects/:id/identity-secret', jwtAuth, async (c) => {
    const projectId = c.req.param('id')!
    const userId = c.get('userId') as string
    const db = getServiceClient()

    if (!(await canManageProjectSdkConfig(db, projectId, userId))) {
      return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Project not found' } }, 404)
    }

    const { error } = await db
      .from('project_settings')
      .update({ assistant_identity_secret_ref: null, identity_secret_created_at: null })
      .eq('project_id', projectId)

    if (error) return dbError(c, error)

    await logAudit(db, projectId, userId, 'settings.updated', 'identity_secret', projectId, {
      action: 'deleted',
    }).catch(() => {})

    log.info('identity_secret_deleted', { projectId })

    return c.json({ ok: true, data: { configured: false } })
  })
}
