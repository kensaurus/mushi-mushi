/**
 * FILE: packages/server/supabase/functions/api/viewer-gate.ts
 * PURPOSE: Viewers have read-only access. Routes that change project data
 *          call this with the role their access check already resolved
 *          (userCanAccessProject / assertTargetProjectAccess), so the rule
 *          and its wording live in one place. Project-bound API keys resolve
 *          as 'owner'; account-level keys carry their owner's real role.
 */
import type { Context } from 'npm:hono@4'

export function denyViewerWrite(
  c: Context,
  role: string | null | undefined,
  action: string,
): Response | null {
  if (role !== 'viewer') return null
  return c.json(
    {
      ok: false,
      error: {
        code: 'FORBIDDEN',
        message: `Viewers have read-only access, so they cannot ${action}. Ask a team owner or admin for member access.`,
      },
    },
    403,
  )
}
