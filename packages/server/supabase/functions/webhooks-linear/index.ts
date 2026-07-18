// SPDX-License-Identifier: MIT
// Copyright (c) 2024–2026 Kenji Sakuramoto (kensaurus) — Mushi Mushi
/**
 * webhooks-linear — Supabase Edge Function
 *
 * Inbound webhook receiver for Linear push events. Linear calls this URL
 * whenever an issue in a connected workspace changes state. Registered
 * automatically during the OAuth install flow (linear-oauth-callback).
 *
 * Handles:
 *   - Issue updated → state type 'completed' or 'cancelled' → resolves the
 *     linked Mushi report (sets status = 'resolved' via resolveExternalIssue).
 *   - Issue created/updated (any state) → dispatches 'linear.issue.updated'
 *     plugin event so third-party plugin-sdk consumers can react.
 *   - OAuthApp revoked → clears project_settings Linear credentials.
 *
 * Security: every request is verified against the Linear-Signature HMAC-SHA256
 * header using the per-project webhook secret stored in vault.
 */

import { createClient } from 'npm:@supabase/supabase-js@2'
import { log as rootLog } from '../_shared/logger.ts'
import { dereferenceMaybeVault } from '../_shared/integration-probes.ts'
import { resolveExternalIssue } from '../_shared/integrations.ts'
import { dispatchPluginEvent } from '../_shared/plugins.ts'

const log = rootLog.child('webhooks-linear')

// ── HMAC signature verification ───────────────────────────────────────────────

/**
 * Verifies a Linear webhook signature.
 *
 * Linear sends:
 *   Linear-Signature: <hex-encoded HMAC-SHA256 of the raw body>
 *
 * We use the per-project webhook secret stored in vault (set during OAuth install
 * by linear-oauth-callback). Returns false if the secret is not configured.
 */
async function verifyLinearSignature(
  body: string,
  signatureHeader: string | null,
  secret: string,
): Promise<boolean> {
  if (!signatureHeader) return false

  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(body))
  const expected = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')

  // Constant-time compare to prevent HMAC timing side-channel
  const a = expected
  const b = signatureHeader.toLowerCase()
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

// ── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 })
  }

  const rawBody = await req.text()
  const signatureHeader = req.headers.get('linear-signature')
  const eventType = req.headers.get('linear-event') // e.g. 'Issue', 'OAuthApp'
  const deliveryId = req.headers.get('linear-delivery') ?? 'unknown'

  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(rawBody)
  } catch {
    log.warn('Invalid JSON payload', { deliveryId })
    return new Response('Bad Request', { status: 400 })
  }

  log.info('Linear webhook received', { eventType, deliveryId, action: payload.action })

  // ── Create service-role client ────────────────────────────────────────────

  const db = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { persistSession: false } },
  )
  // deno-lint-ignore no-explicit-any
  const dbAny = db as any

  // ── Identify the project from organizationId ──────────────────────────────
  //
  // Linear webhooks include organizationId in the payload. We use this to
  // find the project(s) with a matching connection. Multiple projects in the
  // same Mushi org may share a Linear workspace — we fan out to all of them.

  const linearOrgId = (payload.organizationId ?? payload.teamId) as string | undefined

  type ProjectRow = { project_id: string; linear_webhook_secret_ref: string | null }
  let projectRows: ProjectRow[] = []

  if (linearOrgId) {
    // Prefer matching on webhook_secret rows (set per-install) which already
    // bound this URL to a specific project.
    const { data } = await dbAny
      .from('project_settings')
      .select('project_id, linear_webhook_secret_ref')
      .not('linear_webhook_secret_ref', 'is', null)
    projectRows = (data ?? []) as ProjectRow[]
  }

  if (projectRows.length === 0) {
    // Fallback: find projects that have a webhook secret configured.
    // We only include rows with a non-null secret — HMAC verification is
    // mandatory and we cannot authenticate events for installs that lack one.
    const { data } = await dbAny
      .from('project_settings')
      .select('project_id, linear_webhook_secret_ref')
      .not('linear_webhook_secret_ref', 'is', null)
    projectRows = (data ?? []) as ProjectRow[]
  }

  if (projectRows.length === 0) {
    log.warn('No project found for Linear webhook', { deliveryId, linearOrgId })
    // Return 200 so Linear doesn't retry — this can happen for stale webhooks.
    return new Response('OK', { status: 200 })
  }

  // ── Process per project ───────────────────────────────────────────────────

  for (const row of projectRows) {
    const projectId = row.project_id

    // Signature verification is mandatory. Skip any project whose webhook
    // secret is missing or cannot be resolved from vault — we have no way
    // to authenticate the payload without it.
    if (!row.linear_webhook_secret_ref) {
      log.warn('Skipping project without webhook secret', { projectId: row.project_id, deliveryId })
      continue
    }
    const secret = await dereferenceMaybeVault(db, row.linear_webhook_secret_ref)
    if (!secret) {
      log.warn('Webhook secret vault ref unresolvable', { projectId: row.project_id, deliveryId })
      continue
    }
    const valid = await verifyLinearSignature(rawBody, signatureHeader, secret)
    if (!valid) {
      log.warn('Linear signature verification failed', { projectId: row.project_id, deliveryId })
      continue // Wrong secret or tampered payload — skip this project
    }

    try {
      await handleEvent(dbAny, projectId, eventType ?? '', payload, deliveryId)
    } catch (err) {
      log.error('Error handling Linear event', { projectId, deliveryId, err: String(err) })
    }
  }

  // Linear expects a 200 response within 5 seconds or it will retry
  return new Response('OK', { status: 200 })
})

// ── Event handlers ────────────────────────────────────────────────────────────

// deno-lint-ignore no-explicit-any
async function handleEvent(db: any, projectId: string, eventType: string, payload: Record<string, unknown>, deliveryId: string) {
  const action = payload.action as string | undefined

  // ── OAuthApp revoked ────────────────────────────────────────────────────

  if (eventType === 'OAuthApp' && action === 'revoked') {
    log.info('Linear OAuth revoked — clearing credentials', { projectId })
    await db
      .from('project_settings')
      .update({
        linear_access_token_ref: null,
        linear_refresh_token_ref: null,
        linear_webhook_secret_ref: null,
        linear_actor_token_ref: null,
        linear_workspace_name: null,
      })
      .eq('project_id', projectId)
    return
  }

  // ── Issue events ─────────────────────────────────────────────────────────

  if (eventType !== 'Issue') return

  const issueData = payload.data as Record<string, unknown> | undefined
  if (!issueData) return

  const identifier = issueData.identifier as string | undefined
  const stateType = (issueData.state as Record<string, unknown> | undefined)?.type as string | undefined

  // Dispatch plugin event for all issue changes (so plugin-sdk subscribers can react)
  await dispatchPluginEvent(db, projectId, 'linear.issue.updated' as never, {
    linearIssueIdentifier: identifier,
    action,
    stateType,
    issueData,
  }).catch((err: unknown) => {
    log.warn('dispatchPluginEvent linear.issue.updated failed', { projectId, deliveryId, err: String(err) })
  })

  // Auto-resolve Mushi report when the linked Linear issue is completed
  if (action === 'update' && (stateType === 'completed' || stateType === 'cancelled')) {
    if (!identifier) {
      log.warn('Linear Issue update has no identifier', { deliveryId })
      return
    }

    // Find the linked Mushi report
    const { data: extIssues } = await db
      .from('report_external_issues')
      .select('report_id')
      .eq('external_id', identifier)
      .is('resolved_at', null)
      .limit(10)

    if (!extIssues?.length) {
      // No linked report — nothing to do
      return
    }

    for (const extIssue of extIssues as Array<{ report_id: string }>) {
      try {
        await resolveExternalIssue(extIssue.report_id, projectId, db)
        log.info('Resolved Mushi report via Linear issue completion', {
          reportId: extIssue.report_id,
          linearIssue: identifier,
          projectId,
        })
      } catch (err) {
        log.error('resolveExternalIssue failed', {
          reportId: extIssue.report_id,
          identifier,
          err: String(err),
        })
      }
    }
  }
}
