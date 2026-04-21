/**
 * FILE: packages/server/supabase/functions/_shared/dispatch.ts
 * PURPOSE: Shared "dispatch a fix for this report" helper. Extracted so
 *          the admin-API handler, the library-modernizer cron, and the
 *          Slack/Discord interaction endpoints all share one code path
 *          for:
 *              - membership / permission gate
 *              - autofix_enabled gate
 *              - in-flight dedupe (project_id, report_id)
 *              - inserting the fix_dispatch_jobs row
 *              - fire-and-forget invoke of the fix-worker
 *
 *          The previous duplication across admin-API and
 *          library-modernizer meant three separate bug-fix patches for
 *          the same dedupe logic. One helper now, one place to change.
 */

import { getServiceClient } from './db.ts'

export interface DispatchResult {
  ok: boolean
  dispatchId?: string
  status?: string
  createdAt?: string
  code?: 'AUTOFIX_DISABLED' | 'ALREADY_DISPATCHED' | 'DISPATCH_FAILED' | 'FORBIDDEN'
  message?: string
}

interface DispatchInput {
  projectId: string
  reportId: string
  requestedBy: string
  /** When true, bypasses the membership check — used for trusted
   *  server-initiated dispatches (library-modernizer, Slack interactions
   *  after the signing secret has been validated). */
  skipMembershipCheck?: boolean
  /** User identity that triggered the dispatch, when the requester is
   *  not a Supabase user_id. Used for audit. */
  userId?: string
}

export async function dispatchFixForReport(input: DispatchInput): Promise<DispatchResult> {
  const db = getServiceClient()

  if (!input.skipMembershipCheck && input.userId) {
    const { data: membership } = await db
      .from('project_members')
      .select('role')
      .eq('user_id', input.userId)
      .eq('project_id', input.projectId)
      .single()
    if (!membership) {
      return { ok: false, code: 'FORBIDDEN', message: 'Not a member of this project' }
    }
  }

  const { data: settings } = await db
    .from('project_settings')
    .select('autofix_enabled')
    .eq('project_id', input.projectId)
    .single()
  if (!settings?.autofix_enabled) {
    return {
      ok: false,
      code: 'AUTOFIX_DISABLED',
      message: 'Enable Autofix in project settings first',
    }
  }

  const { data: existing } = await db
    .from('fix_dispatch_jobs')
    .select('id, status')
    .eq('project_id', input.projectId)
    .eq('report_id', input.reportId)
    .in('status', ['queued', 'running'])
    .limit(1)
  if (existing?.length) {
    return {
      ok: false,
      code: 'ALREADY_DISPATCHED',
      message: 'A fix dispatch is already in progress for this report',
      dispatchId: existing[0].id,
    }
  }

  const { data: job, error: insertErr } = await db
    .from('fix_dispatch_jobs')
    .insert({
      project_id: input.projectId,
      report_id: input.reportId,
      requested_by: input.requestedBy,
      status: 'queued',
    })
    .select('id, status, created_at')
    .single()
  if (insertErr || !job) {
    return {
      ok: false,
      code: 'DISPATCH_FAILED',
      message: insertErr?.message ?? 'Could not enqueue',
    }
  }

  invokeFixWorker(job.id).catch((err) => {
    console.warn('[dispatch] worker invocation failed', {
      dispatchId: job.id,
      err: String(err),
    })
  })

  return {
    ok: true,
    dispatchId: job.id,
    status: job.status,
    createdAt: job.created_at,
  }
}

export async function invokeFixWorker(dispatchId: string): Promise<void> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) return

  await fetch(`${supabaseUrl}/functions/v1/fix-worker`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ dispatchId }),
    signal: AbortSignal.timeout(2_000),
  }).catch(() => {
    /* fire-and-forget */
  })
}
