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
 * as unresponsive. We post the thought immediately and kick off the longer
 * fix-worker job in the background.
 *
 * Security: signed with Linear-Signature HMAC-SHA256 using the actor token.
 * If no signature is present we fall back to verifying against the
 * webhook secret (same key used for the main webhooks-linear receiver).
 */

import { createClient } from 'npm:@supabase/supabase-js@2'
import { log as rootLog } from '../_shared/logger.ts'
import {
  getLinearActorToken,
  getAgentSessionContext,
  postAgentActivity,
} from '../_shared/linear-agent.ts'
import { dereferenceMaybeVault } from '../_shared/integration-probes.ts'

const log = rootLog.child('webhooks-linear-agent')

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

// ── Handler ───────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })

  const rawBody = await req.text()
  const sigHeader = req.headers.get('linear-signature')
  const deliveryId = req.headers.get('linear-delivery') ?? 'unknown'

  let payload: {
    action?: string
    type?: string
    data?: { agentSession?: { id?: string }; issue?: { id?: string } }
    organizationId?: string
  }
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return new Response('Bad Request', { status: 400 })
  }

  log.info('Linear agent webhook received', { action: payload.action, type: payload.type, deliveryId })

  // Only handle AgentSessionEvent
  if (payload.type !== 'AgentSessionEvent' && payload.action !== 'created') {
    return new Response('OK', { status: 200 })
  }

  const agentSessionId = payload.data?.agentSession?.id
  if (!agentSessionId) {
    log.warn('AgentSessionEvent missing agentSession.id', { deliveryId })
    return new Response('OK', { status: 200 })
  }

  const db = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { persistSession: false } },
  )
  // deno-lint-ignore no-explicit-any
  const dbAny = db as any

  // ── Find project by Linear workspace ─────────────────────────────────────

  const { data: projectRows } = await dbAny
    .from('project_settings')
    .select('project_id, linear_webhook_secret_ref, linear_actor_token_ref, linear_access_token_ref')
    .or('linear_actor_token_ref.not.is.null,linear_access_token_ref.not.is.null')
    .limit(20)

  if (!projectRows?.length) {
    log.warn('No Linear-connected projects found for agent webhook', { deliveryId })
    return new Response('OK', { status: 200 })
  }

  // Verify signature and find matching project
  let projectId: string | null = null
  let actorToken: string | null = null

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
  // webhook URL could otherwise trigger code-mutating fix-worker dispatches.
  if (!projectId) {
    log.warn('Could not match agent webhook to a project', { deliveryId })
    return new Response('OK', { status: 200 })
  }

  actorToken = await getLinearActorToken(db, projectId)
  if (!actorToken) {
    log.warn('No Linear actor token for project', { projectId, deliveryId })
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

  // ── Fetch session context and dispatch to fix-worker ─────────────────────

  // Keep the isolate alive until the background dispatch completes.
  // EdgeRuntime.waitUntil prevents the runtime from killing the isolate after
  // the HTTP response is sent. The ?. guard keeps local (non-edge) dev working.
  // deno-lint-ignore no-explicit-any
  ;(globalThis as any).EdgeRuntime?.waitUntil((async () => {
    try {
      const sessionCtx = await getAgentSessionContext(actorToken!, agentSessionId)
      if (!sessionCtx) {
        log.warn('Could not fetch agent session context', { agentSessionId })
        return
      }

      await postAgentActivity(actorToken!, agentSessionId, {
        type: 'text',
        body: `I'm working on **${sessionCtx.issue.identifier}: ${sessionCtx.issue.title}**. I'll post updates as I make progress.`,
      })

      // Dispatch to fix-worker with Linear issue as context
      const mushiBaseUrl = Deno.env.get('SUPABASE_URL')
      if (mushiBaseUrl) {
        await fetch(`${mushiBaseUrl}/functions/v1/fix-worker`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            projectId,
            trigger: 'linear_agent',
            linearAgentSessionId: agentSessionId,
            linearIssueIdentifier: sessionCtx.issue.identifier,
            linearIssueId: sessionCtx.issue.id,
            linearIssueTitle: sessionCtx.issue.title,
            linearIssueDescription: sessionCtx.issue.description,
            linearIssueUrl: sessionCtx.issue.url,
            promptContext: sessionCtx.promptContext,
          }),
        })
      }

      log.info('Dispatched to fix-worker from Linear agent session', {
        agentSessionId,
        issueIdentifier: sessionCtx.issue.identifier,
        projectId,
      })
    } catch (err) {
      log.error('Linear agent background dispatch failed', { agentSessionId, err: String(err) })
      // Best-effort error activity
      try {
        await postAgentActivity(actorToken!, agentSessionId, {
          type: 'error',
          body: 'Mushi encountered an error starting analysis. Please try reassigning the issue.',
        })
      } catch {
        // Ignore
      }
    }
  })())

  // Return immediately so Linear receives its 200 within the 10s window
  return new Response('OK', { status: 200 })
})
