/**
 * gate-finding-dismiss.ts — dismiss one gate finding with a reason.
 *
 *   POST /v1/admin/projects/:pid/gate-findings/:id/dismiss   jwtAuth
 *   body: { reason: string }  (3 to 300 characters after trimming)
 *
 * Sets the finding's existing `allowlisted = true` and `allowlist_reason`, so
 * every open-finding count and list (which already skip allowlisted rows)
 * stops showing it. Dismissing is a person's decision: a signed-in console
 * session only (no API key), a member of the project but not a viewer, and
 * every dismissal is written to the audit log.
 *
 * A dismissal belongs to this one row. A later run of the same check writes
 * new rows, so the finding comes back if that run finds it again.
 *
 * Before there was no way to close a stale finding except a new run
 * (glot.it, 2026-10-07).
 */

import type { Hono, MiddlewareHandler } from 'npm:hono@4'
import { z } from 'npm:zod@3'
import { jwtAuth } from '../../_shared/auth.ts'
import { logAudit } from '../../_shared/audit.ts'
import { getServiceClient } from '../../_shared/db.ts'
import { callerCanAccessProject, dbError, jsonError } from '../shared.ts'
import { denyViewerWrite } from '../viewer-gate.ts'
import type { Variables } from '../types.ts'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const DISMISS_REASON_MIN = 3
const DISMISS_REASON_MAX = 300

const DismissBody = z.object({
  reason: z.string().trim().min(DISMISS_REASON_MIN).max(DISMISS_REASON_MAX),
})

type Db = ReturnType<typeof getServiceClient>

/** @internal Exported for tests only. */
export interface GateFindingDismissDeps {
  getServiceClient: () => Db
  jwtAuth: MiddlewareHandler
}

const defaultDeps: GateFindingDismissDeps = {
  getServiceClient,
  jwtAuth: jwtAuth as MiddlewareHandler,
}

export function registerGateFindingDismissRoutes(
  app: Hono<{ Variables: Variables }>,
  deps: GateFindingDismissDeps = defaultDeps,
): void {
  app.post('/v1/admin/projects/:pid/gate-findings/:id/dismiss', deps.jwtAuth, async (c) => {
    const projectId = c.req.param('pid') ?? ''
    const findingId = c.req.param('id') ?? ''
    if (!UUID_RE.test(projectId) || !UUID_RE.test(findingId)) {
      return jsonError(c, 'NOT_FOUND', 'Finding not found', 404)
    }

    const body = DismissBody.safeParse(await c.req.json().catch(() => null))
    if (!body.success) {
      return jsonError(
        c,
        'VALIDATION_ERROR',
        `Say why this finding is not a problem, in ${DISMISS_REASON_MIN} to ${DISMISS_REASON_MAX} characters.`,
      )
    }
    const reason = body.data.reason

    const userId = c.get('userId') as string
    const db = deps.getServiceClient()
    // A project the caller cannot reach reads the same as a missing finding.
    const access = await callerCanAccessProject(c, db, userId, projectId)
    if (!access.allowed) return jsonError(c, 'NOT_FOUND', 'Finding not found', 404)
    const denied = denyViewerWrite(c, access.role, 'dismiss findings')
    if (denied) return denied

    // Scoped to :pid, so a finding id from another project is a 404 here.
    const { data: row, error: readErr } = await db
      .from('gate_findings')
      .select('id, gate_run_id, rule_id, allowlisted, allowlist_reason')
      .eq('id', findingId)
      .eq('project_id', projectId)
      .maybeSingle()
    if (readErr) return dbError(c, readErr)
    const finding = row as { id: string; gate_run_id: string; rule_id: string | null; allowlisted: boolean; allowlist_reason: string | null } | null
    if (!finding) return jsonError(c, 'NOT_FOUND', 'Finding not found', 404)

    if (finding.allowlisted) {
      return c.json({
        ok: true,
        data: { id: finding.id, allowlisted: true, allowlistReason: finding.allowlist_reason, alreadyDismissed: true },
      })
    }

    // Only an open row is written, so two clicks at once write (and audit) once.
    const { data: updated, error: updErr } = await db
      .from('gate_findings')
      .update({ allowlisted: true, allowlist_reason: reason })
      .eq('id', findingId)
      .eq('project_id', projectId)
      .eq('allowlisted', false)
      .select('id')
    if (updErr) return dbError(c, updErr)
    if (!Array.isArray(updated) || updated.length === 0) {
      return c.json({ ok: true, data: { id: findingId, allowlisted: true, allowlistReason: null, alreadyDismissed: true } })
    }

    await logAudit(db, projectId, userId, 'gate_finding.dismissed', 'gate_finding', findingId, {
      reason,
      rule_id: finding.rule_id,
      gate_run_id: finding.gate_run_id,
    }).catch(() => null)

    return c.json({ ok: true, data: { id: findingId, allowlisted: true, allowlistReason: reason, alreadyDismissed: false } })
  })
}
