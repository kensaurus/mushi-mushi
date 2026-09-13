// SPDX-License-Identifier: MIT
// Copyright (c) 2024–2026 Kenji Sakuramoto (kensaurus) — Mushi Mushi
/**
 * cursor-webhook — Supabase Edge Function (verify_jwt = false)
 *
 * Receives Cursor Cloud Agents **v0** `statusChange` webhooks
 * (https://cursor.com/docs/cloud-agent/api/webhooks). v1 webhooks are still
 * "coming soon", so this is the only push path Cursor offers today; the
 * fix-worker registers it on POST /v0/agents when `CURSOR_USE_V0_WEBHOOK=1`
 * (`_shared/cursor-cloud.ts`). Without that flag nothing ever calls this
 * function and `agent-status-poll` alone closes the loop.
 *
 * Wire (from Cursor):
 *   POST /functions/v1/cursor-webhook?project=<project uuid>
 *   X-Webhook-Signature: sha256=<hex HMAC-SHA256 over the RAW body>
 *   X-Webhook-ID:        <delivery id, stable across retries>
 *   X-Webhook-Event:     statusChange
 *   User-Agent:          Cursor-Agent-Webhook/1.0
 *   { event, timestamp, id (agent id), status: FINISHED | ERROR,
 *     source: { repository, ref }, target: { url, branchName, prUrl }, summary }
 *
 * Security: no JWT (Cursor cannot send one). The HMAC secret is
 * `buildV0WebhookSecret(project)` — derived from MUSHI_INTERNAL_CALLER_SECRET
 * and the project id, never stored — and the comparison is constant-time.
 * A bad signature is a 401 and nothing is read from the body. Everything
 * after a valid signature answers 200 (Cursor retries non-2xx, and nothing
 * below is retry-able); duplicates are dropped on X-Webhook-ID, which is
 * remembered on `fix_attempts.external_agent_ref.webhook_ids`.
 *
 * Effects (all through `_shared/agent-adapters.ts applyCloudAgentOutcome`,
 * the same path the poller and the GitHub indexer use, so the three never
 * double-notify):
 *   FINISHED + target.prUrl → fix_attempts.pr_url / pr_state 'open' /
 *                             status 'completed' (guarded on pr_url IS NULL;
 *                             uq_fix_attempts_pr_url conflicts are skipped),
 *                             reports.fix_pr_url mirrored, fix_dispatch_jobs
 *                             'completed', fix_events pr_opened, team card
 *                             'fix_pr_opened', plugin `fix.proposed`.
 *   FINISHED, no prUrl      → attempt failed ("finished without a PR"),
 *                             job 'completed_no_pr', team 'fix_failed'.
 *   ERROR                   → attempt failed (cursor_api_error), job 'failed',
 *                             team 'fix_failed', plugin `fix.failed`.
 */

import { z } from 'npm:zod@3'
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { getServiceClient } from '../_shared/db.ts'
import { log as rootLog } from '../_shared/logger.ts'
import { withSentry } from '../_shared/sentry.ts'
import { buildV0WebhookSecret, verifyV0WebhookSignature } from '../_shared/cursor-cloud.ts'
import { applyCloudAgentOutcome, type FixAttemptRow } from '../_shared/agent-adapters.ts'

const log = rootLog.child('cursor-webhook')

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_WEBHOOK_IDS_REMEMBERED = 25

export const cursorWebhookPayloadSchema = z
  .object({
    event: z.string().optional(),
    timestamp: z.string().optional(),
    id: z.string().min(1).max(200),
    status: z.string().min(1).max(40),
    source: z.object({ repository: z.string().optional(), ref: z.string().optional() }).passthrough().optional(),
    target: z
      .object({
        url: z.string().optional(),
        branchName: z.string().max(500).optional(),
        prUrl: z.string().url().optional(),
      })
      .passthrough()
      .optional(),
    summary: z.string().max(20_000).optional(),
  })
  .passthrough()

export type CursorWebhookPayload = z.infer<typeof cursorWebhookPayloadSchema>

export interface CursorWebhookDeps {
  db: SupabaseClient
  /** Override for tests; defaults to buildV0WebhookSecret(projectId). */
  secretFor: (projectId: string) => Promise<string>
}

function json(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const ATTEMPT_COLUMNS =
  'id, project_id, report_id, agent, status, pr_url, branch_name, cursor_agent_id, cursor_run_id, external_agent_ref'

export async function handleCursorWebhook(req: Request, deps: Partial<CursorWebhookDeps> = {}): Promise<Response> {
  if (req.method !== 'POST') {
    return json({ ok: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'POST only' } }, 405)
  }

  const projectId = new URL(req.url).searchParams.get('project')
  if (!projectId || !UUID_RE.test(projectId)) {
    return json({ ok: false, error: { code: 'MISSING_PROJECT', message: '?project=<uuid> is required' } }, 400)
  }

  const rawBody = await req.text()
  const signature = req.headers.get('X-Webhook-Signature')

  let secret: string
  try {
    secret = deps.secretFor ? await deps.secretFor(projectId) : await buildV0WebhookSecret(projectId)
  } catch (err) {
    log.error('Cannot derive Cursor webhook secret', { projectId, err: String(err) })
    return json({ ok: false, error: { code: 'SERVER_MISCONFIGURED', message: 'webhook secret unavailable' } }, 500)
  }

  if (!(await verifyV0WebhookSignature(rawBody, signature, secret))) {
    log.warn('Cursor webhook signature rejected', { projectId, hasSignature: !!signature })
    return json({ ok: false, error: { code: 'INVALID_SIGNATURE', message: 'X-Webhook-Signature mismatch' } }, 401)
  }

  // ── Verified from here on: always 200 ──────────────────────────────────────
  let parsedJson: unknown
  try {
    parsedJson = JSON.parse(rawBody)
  } catch {
    return json({ ok: true, ignored: 'invalid_json' }, 200)
  }
  const parsed = cursorWebhookPayloadSchema.safeParse(parsedJson)
  if (!parsed.success) {
    log.warn('Cursor webhook payload failed validation', { projectId, issue: parsed.error.issues[0]?.message })
    return json({ ok: true, ignored: 'invalid_payload' }, 200)
  }
  const payload: CursorWebhookPayload = parsed.data
  const webhookId = req.headers.get('X-Webhook-ID')
  const eventType = req.headers.get('X-Webhook-Event') ?? payload.event ?? 'statusChange'

  const db = deps.db ?? getServiceClient()
  const { data: attemptRow, error: attemptErr } = await db
    .from('fix_attempts')
    .select(ATTEMPT_COLUMNS)
    .eq('project_id', projectId)
    .eq('cursor_agent_id', payload.id)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (attemptErr) {
    log.error('fix_attempts lookup failed', { projectId, agentId: payload.id, error: attemptErr.message })
    return json({ ok: true, ignored: 'lookup_failed' }, 200)
  }
  if (!attemptRow) {
    log.info('Cursor webhook for unknown agent — ignored', { projectId, agentId: payload.id, eventType })
    return json({ ok: true, ignored: 'unknown_agent' }, 200)
  }
  const attempt = attemptRow as FixAttemptRow

  // Dedupe on X-Webhook-ID: Cursor retries on non-2xx and may redeliver.
  const ref = (attempt.external_agent_ref ?? {}) as Record<string, unknown>
  const seen = Array.isArray(ref.webhook_ids)
    ? (ref.webhook_ids as unknown[]).filter((s): s is string => typeof s === 'string')
    : []
  if (webhookId && seen.includes(webhookId)) {
    return json({ ok: true, duplicate: true, fixAttemptId: attempt.id }, 200)
  }
  if (webhookId) {
    await db
      .from('fix_attempts')
      .update({
        external_agent_ref: {
          ...ref,
          webhook_ids: [...seen, webhookId].slice(-MAX_WEBHOOK_IDS_REMEMBERED),
          last_webhook_at: new Date().toISOString(),
          last_webhook_status: payload.status,
        },
      })
      .eq('id', attempt.id)
  }

  const target = {
    attemptId: attempt.id,
    projectId: attempt.project_id,
    reportId: attempt.report_id,
    agent: attempt.agent,
  }
  const status = payload.status.toUpperCase()
  const branch = payload.target?.branchName ?? attempt.branch_name ?? null

  let result: Awaited<ReturnType<typeof applyCloudAgentOutcome>>
  if (status === 'FINISHED') {
    const prUrl = payload.target?.prUrl
    result = prUrl
      ? await applyCloudAgentOutcome(db, target, {
          kind: 'pr_opened',
          prUrl,
          branch,
          summary: payload.summary ?? null,
        })
      : await applyCloudAgentOutcome(db, target, { kind: 'completed_no_pr', summary: payload.summary ?? null })
  } else if (status === 'ERROR' || status === 'EXPIRED' || status === 'CANCELLED') {
    result = await applyCloudAgentOutcome(db, target, {
      kind: 'failed',
      error: `Cursor run ${status}${payload.summary ? `: ${payload.summary.slice(0, 500)}` : ''}`,
      failureCategory: 'cursor_api_error',
    })
  } else {
    return json({ ok: true, ignored: 'non_terminal_status', status: payload.status, fixAttemptId: attempt.id }, 200)
  }

  log.info('Cursor webhook applied', {
    projectId,
    fixAttemptId: attempt.id,
    agentId: payload.id,
    status,
    applied: result.applied,
    reason: result.reason ?? null,
  })
  return json({ ok: true, applied: result.applied, reason: result.reason ?? null, fixAttemptId: attempt.id }, 200)
}

if (typeof Deno !== 'undefined') {
  Deno.serve(withSentry('cursor-webhook', (req) => handleCursorWebhook(req)))
}
