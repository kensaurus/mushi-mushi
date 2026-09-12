// SPDX-License-Identifier: MIT
// Copyright (c) 2024–2026 Kenji Sakuramoto (kensaurus) — Mushi Mushi
/**
 * webhooks-linear-agent — Supabase Edge Function
 *
 * Receives Linear AgentSessionEvent webhooks (enabled in Linear app settings →
 * "Agent session events"). These fire when a user assigns an issue to the Mushi
 * agent or @-mentions Mushi in a comment.
 *
 * Critical timing: Linear requires an 'acknowledgement' (thought activity)
 * within 10 seconds of receiving an AgentSessionEvent or it marks the agent
 * as unresponsive. We post the thought immediately and run the dispatch in the
 * background.
 *
 * Dispatch (fixed 2026-09-12, exec plan row 35): this function used to POST
 * `fix-worker` a `{ trigger: 'linear_agent', … }` body that the worker's only
 * request path rejects with 400 `dispatchId required`; the 400 was swallowed
 * by a `.catch(() => {})` + 2 s abort and the log claimed success. The worker
 * needs a QUEUED `fix_dispatch_jobs` row, which needs a report. So now:
 *   1. find-or-create the Mushi report for the Linear issue
 *      (`report_external_issues` system='linear' is the mapping; a new report
 *      is inserted with custom_metadata.source = 'linear' — and
 *      `reports.source = 'linear'` once that column exists);
 *   2. `dispatchFixForReport({ projectId, reportId, metadata: { source:
 *      'linear', linearAgentSessionId } })` — the same helper Slack uses;
 *   3. log the REAL result code and post it back to the Linear agent session
 *      (text on success, error on AUTOFIX_DISABLED / DISPATCH_FAILED).
 *
 * Security: signed with Linear-Signature HMAC-SHA256 using the actor token.
 * If no signature is present we fall back to verifying against the
 * webhook secret (same key used for the main webhooks-linear receiver).
 * Every request also goes through `_shared/webhook-middleware.ts` for the
 * audit log, the per-IP rate limit, and the 24h replay cache keyed on the
 * `Linear-Delivery` header. The replay cache matters most here: this handler
 * dispatches a code-mutating fix job, and Linear retries any delivery it does
 * not see acknowledged inside 10 seconds — so a retry used to start a SECOND
 * fix job for the same agent session.
 */

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { log as rootLog } from '../_shared/logger.ts'
import {
  getLinearActorToken,
  getAgentSessionContext,
  postAgentActivity,
  type AgentSessionData,
} from '../_shared/linear-agent.ts'
import { dereferenceMaybeVault } from '../_shared/integration-probes.ts'
import { createWebhookMiddleware, ReplayAttackError, RateLimitError } from '../_shared/webhook-middleware.ts'
import { dispatchFixForReport, type DispatchResult } from '../_shared/dispatch.ts'

const log = rootLog.child('webhooks-linear-agent')

/**
 * Minimal shim so the Hono-shaped `createWebhookMiddleware().audit()` can read
 * headers/method/url off a raw `Request` — this function uses `Deno.serve`
 * directly. Mirrors the identical shim in slack-interactions/index.ts.
 */
function toWebhookContext(req: Request) {
  return {
    req: {
      header: (name: string) => req.headers.get(name) ?? undefined,
      method: req.method,
      url: req.url,
    },
  }
}

// ── HMAC verification ─────────────────────────────────────────────────────────

async function verifyHmac(body: string, header: string | null, secret: string): Promise<boolean> {
  if (!header) return false
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(body))
  const hex = Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('')
  // Constant-time compare to prevent HMAC timing side-channel
  const a = hex
  const b = header.toLowerCase()
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

// ── Linear issue → Mushi report ──────────────────────────────────────────────

/** Linear priority (0 none, 1 urgent … 4 low) → Mushi severity. */
export function linearPriorityToSeverity(priority: number | null | undefined): 'low' | 'medium' | 'high' | 'critical' {
  switch (priority) {
    case 1:
      return 'critical'
    case 2:
      return 'high'
    case 3:
      return 'medium'
    default:
      return 'low'
  }
}

export interface LinearReportResolution {
  reportId: string
  created: boolean
}

/**
 * Find the Mushi report already linked to this Linear issue
 * (`report_external_issues` system='linear', external_id = issue id — the row
 * `createExternalIssue` writes for outbound Linear tickets), or create one
 * from the issue. Idempotent per issue: a second agent session on the same
 * issue re-uses the report, and `dispatchFixForReport`'s in-flight guard then
 * answers ALREADY_DISPATCHED instead of starting a second job.
 */
export async function findOrCreateLinearReport(
  db: SupabaseClient,
  projectId: string,
  session: Pick<AgentSessionData, 'id' | 'issue' | 'promptContext'>,
): Promise<LinearReportResolution> {
  const issue = session.issue
  const { data: existing } = await db
    .from('report_external_issues')
    .select('report_id')
    .eq('project_id', projectId)
    .eq('system', 'linear')
    .eq('external_id', issue.id)
    .order('created_at', { ascending: false })
    .limit(1)
  if (existing && existing.length > 0) {
    const reportId = (existing[0] as { report_id: string }).report_id
    const { data: report } = await db.from('reports').select('id').eq('id', reportId).maybeSingle()
    if (report) return { reportId, created: false }
  }

  const title = issue.title?.trim() || issue.identifier
  const body = (issue.description ?? '').trim()
  const description = [
    `${issue.identifier}: ${title}`,
    body,
    session.promptContext ? `\nAgent session context:\n${session.promptContext.slice(0, 4000)}` : '',
  ]
    .filter((s) => s.length > 0)
    .join('\n\n')
    .slice(0, 5000)

  const nowIso = new Date().toISOString()
  const row: Record<string, unknown> = {
    project_id: projectId,
    description,
    summary: `${issue.identifier}: ${title}`.slice(0, 500),
    user_category: 'bug',
    category: 'bug',
    severity: linearPriorityToSeverity(issue.priority),
    status: 'new',
    reporter_token_hash: 'linear-agent',
    custom_metadata: {
      source: 'linear',
      kind: 'agent_session',
      linearIssueId: issue.id,
      linearIssueIdentifier: issue.identifier,
      linearIssueUrl: issue.url,
      linearAgentSessionId: session.id,
      linearPriority: issue.priority ?? null,
      linearState: issue.state?.name ?? null,
    },
    environment: {
      userAgent: 'linear-agent',
      platform: 'linear',
      language: '',
      viewport: { width: 0, height: 0 },
      url: issue.url,
      referrer: '',
      timestamp: nowIso,
      timezone: 'UTC',
    },
    created_at: nowIso,
  }

  // `reports.source` is added by a sibling migration; write it when the
  // column exists and fall back to custom_metadata.source alone when the
  // schema has not caught up (PostgREST answers 42703 / PGRST204).
  let inserted = await db.from('reports').insert({ ...row, source: 'linear' }).select('id').single()
  if (inserted.error && /source|PGRST204|42703/i.test(`${inserted.error.code} ${inserted.error.message}`)) {
    inserted = await db.from('reports').insert(row).select('id').single()
  }
  if (inserted.error || !inserted.data) {
    throw new Error(`reports insert failed: ${inserted.error?.message ?? 'no row returned'}`)
  }
  const reportId = (inserted.data as { id: string }).id

  const { error: linkErr } = await db.from('report_external_issues').insert({
    report_id: reportId,
    project_id: projectId,
    system: 'linear',
    external_id: issue.id,
    external_url: issue.url,
  })
  if (linkErr && linkErr.code !== '23505') {
    log.warn('report_external_issues link insert failed (non-fatal)', { reportId, err: linkErr.message })
  }
  return { reportId, created: true }
}

export interface LinearAgentDispatchInput {
  projectId: string
  agentSessionId: string
  actorToken: string
  session: AgentSessionData
}

export interface LinearAgentDispatchOutcome {
  ok: boolean
  code: DispatchResult['code'] | 'OK'
  reportId: string
  dispatchId: string | null
  reportCreated: boolean
  message: string
}

export interface LinearAgentDispatchDeps {
  dispatch: typeof dispatchFixForReport
  postActivity: typeof postAgentActivity
}

/** Human message posted back into the Linear agent session per outcome. */
export function describeDispatchOutcome(result: DispatchResult, issueIdentifier: string): string {
  if (result.ok) {
    return `Dispatched a fix for **${issueIdentifier}** (Mushi dispatch \`${result.dispatchId}\`). I'll open a draft pull request when the agent finishes.`
  }
  switch (result.code) {
    case 'AUTOFIX_DISABLED':
      return 'Autofix is disabled for this Mushi project. Enable it under Settings → Auto-fix in the Mushi console, then reassign the issue.'
    case 'ALREADY_DISPATCHED':
      return `A fix is already in progress for **${issueIdentifier}** (Mushi dispatch \`${result.dispatchId ?? 'unknown'}\`). I'll report back on that one.`
    case 'FORBIDDEN':
      return 'Mushi is not allowed to dispatch fixes for this project. Check the Linear integration under Settings → Integrations.'
    default:
      return `Mushi could not start a fix: ${result.message ?? 'dispatch failed'}. Please try reassigning the issue.`
  }
}

/**
 * The real dispatch: report row → dispatchFixForReport → Linear activity.
 * Exported so the contract test can drive it with a fake db + fake helpers.
 */
export async function runLinearAgentDispatch(
  db: SupabaseClient,
  input: LinearAgentDispatchInput,
  deps: LinearAgentDispatchDeps = { dispatch: dispatchFixForReport, postActivity: postAgentActivity },
): Promise<LinearAgentDispatchOutcome> {
  const { projectId, agentSessionId, actorToken, session } = input
  const { reportId, created } = await findOrCreateLinearReport(db, projectId, session)

  const result = await deps.dispatch({
    projectId,
    reportId,
    requestedBy: null,
    skipMembershipCheck: true,
    metadata: {
      source: 'linear',
      requestedBy: 'linear-agent',
      linearAgentSessionId: agentSessionId,
      linearIssueId: session.issue.id,
      linearIssueIdentifier: session.issue.identifier,
    },
  })

  const message = describeDispatchOutcome(result, session.issue.identifier)
  const outcome: LinearAgentDispatchOutcome = {
    ok: result.ok,
    code: result.ok ? 'OK' : (result.code ?? 'DISPATCH_FAILED'),
    reportId,
    dispatchId: result.dispatchId ?? null,
    reportCreated: created,
    message,
  }

  if (result.ok) {
    log.info('Linear agent session dispatched a fix', {
      agentSessionId,
      projectId,
      reportId,
      dispatchId: result.dispatchId,
      reportCreated: created,
      issueIdentifier: session.issue.identifier,
    })
  } else {
    log.warn('Linear agent session dispatch not started', {
      agentSessionId,
      projectId,
      reportId,
      code: result.code,
      message: result.message,
      issueIdentifier: session.issue.identifier,
    })
  }

  try {
    await deps.postActivity(actorToken, agentSessionId, {
      type: result.ok || result.code === 'ALREADY_DISPATCHED' ? 'text' : 'error',
      body: message,
    })
  } catch (err) {
    log.warn('Failed to post Linear dispatch outcome activity', { agentSessionId, err: String(err) })
  }

  return outcome
}

// ── Handler ───────────────────────────────────────────────────────────────────

export async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })

  const t0 = Date.now()
  const rawBody = await req.text()
  const sigHeader = req.headers.get('linear-signature')
  // Keep the raw (nullable) delivery id for the audit row and the replay
  // cache. Collapsing a missing header into 'unknown' before those would make
  // the FIRST header-less delivery poison the 24h replay bucket and 409 every
  // header-less delivery after it. 'unknown' stays a log-only placeholder.
  const deliveryIdRaw = req.headers.get('linear-delivery')
  const deliveryId = deliveryIdRaw ?? 'unknown'

  const { audit, checkReplay, checkRateLimit } = createWebhookMiddleware('linear')
  const sourceIp =
    req.headers.get('CF-Connecting-IP') ??
    req.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ??
    null

  const auditRow = await audit(toWebhookContext(req) as never, rawBody, deliveryIdRaw)
  try {
    checkRateLimit(sourceIp)
    await checkReplay(auditRow.id, deliveryIdRaw)
  } catch (err) {
    if (err instanceof RateLimitError) {
      await auditRow.resolve('rejected_rate_limit', 429, Date.now() - t0, err.message)
      return new Response('Rate limited', { status: 429 })
    }
    if (err instanceof ReplayAttackError) {
      // Linear retried a delivery we already ran. Returning 409 (instead of
      // silently re-dispatching) is what keeps one agent session from starting
      // two fix jobs.
      await auditRow.resolve('rejected_replay', 409, Date.now() - t0, err.message)
      return new Response('Duplicate delivery', { status: 409 })
    }
    throw err
  }

  let payload: {
    action?: string
    type?: string
    data?: { agentSession?: { id?: string }; issue?: { id?: string } }
    organizationId?: string
  }
  try {
    payload = JSON.parse(rawBody)
  } catch {
    await auditRow.resolve('error', 400, Date.now() - t0, 'Invalid JSON payload')
    return new Response('Bad Request', { status: 400 })
  }

  log.info('Linear agent webhook received', { action: payload.action, type: payload.type, deliveryId })

  // Only handle AgentSessionEvent
  if (payload.type !== 'AgentSessionEvent' && payload.action !== 'created') {
    await auditRow.resolve('accepted', 200, Date.now() - t0, 'Not an AgentSessionEvent')
    return new Response('OK', { status: 200 })
  }

  const agentSessionId = payload.data?.agentSession?.id
  if (!agentSessionId) {
    log.warn('AgentSessionEvent missing agentSession.id', { deliveryId })
    await auditRow.resolve('accepted', 200, Date.now() - t0, 'Missing agentSession.id')
    return new Response('OK', { status: 200 })
  }

  const db = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { persistSession: false } },
  )

  // ── Find project by Linear workspace ─────────────────────────────────────

  const { data: projectRows } = await db
    .from('project_settings')
    .select('project_id, linear_webhook_secret_ref, linear_actor_token_ref, linear_access_token_ref')
    .or('linear_actor_token_ref.not.is.null,linear_access_token_ref.not.is.null')
    .limit(20)

  if (!projectRows?.length) {
    log.warn('No Linear-connected projects found for agent webhook', { deliveryId })
    await auditRow.resolve('accepted', 200, Date.now() - t0, 'No Linear-connected projects')
    return new Response('OK', { status: 200 })
  }

  // Verify signature and find matching project
  let projectId: string | null = null

  for (const row of projectRows as Array<{ project_id: string; linear_webhook_secret_ref: string | null }>) {
    if (row.linear_webhook_secret_ref) {
      const secret = await dereferenceMaybeVault(db, row.linear_webhook_secret_ref)
      if (secret) {
        const valid = await verifyHmac(rawBody, sigHeader, secret)
        if (valid) {
          projectId = row.project_id
          break
        }
      }
    }
  }

  // No fallback: if HMAC verification did not match any project, drop the
  // event. Never process an unauthenticated payload — an attacker with the
  // webhook URL could otherwise trigger code-mutating fix dispatches.
  if (!projectId) {
    log.warn('Could not match agent webhook to a project', { deliveryId })
    // NOT 'accepted': an unauthenticated payload must never claim the
    // replay-cache slot belonging to the real delivery with this id.
    await auditRow.resolve('rejected_signature', 200, Date.now() - t0, 'No project matched the signature')
    return new Response('OK', { status: 200 })
  }

  const actorToken = await getLinearActorToken(db, projectId)
  if (!actorToken) {
    log.warn('No Linear actor token for project', { projectId, deliveryId })
    await auditRow.resolve('accepted', 200, Date.now() - t0, 'No Linear actor token for project')
    return new Response('OK', { status: 200 })
  }

  // ── CRITICAL: acknowledge within 10 seconds ───────────────────────────────

  try {
    await postAgentActivity(actorToken, agentSessionId, {
      type: 'thought',
      body: 'Mushi is analyzing this issue...',
    })
    log.info('Posted Linear agent acknowledgement', { agentSessionId, projectId })
  } catch (err) {
    log.error('Failed to post Linear agent thought', { agentSessionId, err: String(err) })
    // Don't return early — still attempt to dispatch even if acknowledgement fails
  }

  // ── Fetch session context and dispatch ────────────────────────────────────

  // Keep the isolate alive until the background dispatch completes.
  // EdgeRuntime.waitUntil prevents the runtime from killing the isolate after
  // the HTTP response is sent. The ?. guard keeps local (non-edge) dev working.
  const resolvedProjectId = projectId
  const background = (async () => {
    try {
      const sessionCtx = await getAgentSessionContext(actorToken, agentSessionId)
      if (!sessionCtx) {
        log.warn('Could not fetch agent session context', { agentSessionId })
        return
      }

      await postAgentActivity(actorToken, agentSessionId, {
        type: 'text',
        body: `I'm working on **${sessionCtx.issue.identifier}: ${sessionCtx.issue.title}**. I'll post updates as I make progress.`,
      })

      await runLinearAgentDispatch(db, {
        projectId: resolvedProjectId,
        agentSessionId,
        actorToken,
        session: sessionCtx,
      })
    } catch (err) {
      log.error('Linear agent background dispatch failed', { agentSessionId, err: String(err) })
      // Best-effort error activity
      try {
        await postAgentActivity(actorToken, agentSessionId, {
          type: 'error',
          body: 'Mushi encountered an error starting analysis. Please try reassigning the issue.',
        })
      } catch {
        // Ignore
      }
    }
  })()
  const edgeRuntime = (globalThis as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime
  if (edgeRuntime?.waitUntil) edgeRuntime.waitUntil(background)
  else background.catch(() => undefined)

  // Resolve the audit row BEFORE returning. `checkReplay` only counts rows
  // already marked 'accepted', so this write is what makes a Linear retry of
  // this delivery a 409 instead of a second fix dispatch. It runs ahead
  // of the background task above by design.
  await auditRow.resolve('accepted', 200, Date.now() - t0)

  // Return immediately so Linear receives its 200 within the 10s window
  return new Response('OK', { status: 200 })
}

if (typeof Deno !== 'undefined') {
  Deno.serve(handler)
}
