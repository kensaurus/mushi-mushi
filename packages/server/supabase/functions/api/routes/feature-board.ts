// feature-board.ts — Community-driven feature request board endpoints
//
// Admin (JWT, org-scoped):
//   GET    /v1/admin/feature-board           — list feature tickets with vote/comment counts
//   GET    /v1/admin/feature-board/:id       — single feature ticket detail
//   POST   /v1/admin/feature-board/:id/vote  — toggle vote on / off (idempotent; handles 23505)
//   GET    /v1/admin/feature-board/:id/comments — list comments
//   POST   /v1/admin/feature-board/:id/comments — add a comment
//   POST   /v1/admin/feature-board/:id/ship  — mark shipped + fire Standard-Webhooks notification
//
// Data-pipeline discipline:
//   • vote_count is always COUNT(*) — never an incremented integer.
//   • Votes are idempotent: duplicate insert on (user_id, request_id) is
//     caught as 23505 (unique_violation) and returned as { voted: true }.
//   • The "shipped" notification reuses the a2a-push-notify HMAC signer
//     (Standard-Webhooks v1 format) generalized off fix_dispatch_jobs.

import { Hono } from 'npm:hono@4'
import type { Context } from 'npm:hono@4'
import { requireAuth } from '../middleware/auth.ts'
import { requireProjectAccess } from '../middleware/project.ts'
import { getServiceClient } from '../../_shared/db.ts'
import { log } from '../../_shared/logger.ts'
import type { Variables } from '../types.ts'

declare const Deno: { env: { get(name: string): string | undefined } }

const flog = log.child('feature-board')

const DELIVERY_TIMEOUT_MS = 8_000
const SHIP_EVENT_TYPE = 'feature_request.shipped'

// ── Standard-Webhooks HMAC-SHA256 signer ─────────────────────────────────────
// Reused from a2a-push-notify/index.ts (same algorithm, different payload).
async function signHmacBase64(secret: string, payload: string): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payload))
  const bytes = new Uint8Array(sig)
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin)
}

function isHttpsUrl(url: string): boolean {
  try {
    const u = new URL(url)
    if (u.protocol !== 'https:') return false
    if (Deno.env.get('MUSHI_ALLOW_INTERNAL_PUSH') === '1') return true
    const host = u.hostname.toLowerCase()
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return false
    if (/^10\./.test(host) || /^192\.168\./.test(host)) return false
    if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(host)) return false
    return true
  } catch {
    return false
  }
}

// ── Notify requester that their feature shipped ───────────────────────────────
async function fireShippedNotification(
  ticket: {
    id: string
    project_id: string
    user_email: string
    subject: string
    shipped_in_release_id: string | null
    shipped_note: string | null
  },
  projectPushUrl: string | null,
  projectPushSecret: string | null,
): Promise<{ sent: boolean; skipped?: string; statusCode?: number }> {
  if (!projectPushUrl) return { sent: false, skipped: 'no_push_url' }
  if (!isHttpsUrl(projectPushUrl)) {
    flog.warn('Refusing ship notification to non-HTTPS/internal URL', { projectPushUrl })
    return { sent: false, skipped: 'invalid_url' }
  }

  const deliveryId = crypto.randomUUID()
  const stdTimestamp = String(Math.floor(Date.now() / 1000))
  const envelope = {
    event: SHIP_EVENT_TYPE,
    deliveryId,
    timestamp: new Date().toISOString(),
    featureRequest: {
      id: ticket.id,
      projectId: ticket.project_id,
      subject: ticket.subject,
      userEmail: ticket.user_email,
      shippedInReleaseId: ticket.shipped_in_release_id,
      shippedNote: ticket.shipped_note,
    },
  }
  const rawBody = JSON.stringify(envelope)

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'webhook-id': deliveryId,
    'webhook-timestamp': stdTimestamp,
    'X-Mushi-Event': SHIP_EVENT_TYPE,
    'X-Mushi-Delivery': deliveryId,
    'X-Mushi-Project': ticket.project_id,
  }

  if (projectPushSecret) {
    const sig = await signHmacBase64(
      projectPushSecret,
      `${deliveryId}.${stdTimestamp}.${rawBody}`,
    )
    headers['webhook-signature'] = `v1,${sig}`
  }

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS)
    const res = await fetch(projectPushUrl, {
      method: 'POST',
      headers,
      body: rawBody,
      signal: controller.signal,
      redirect: 'error',
    })
    clearTimeout(timer)
    flog.info('Ship notification delivered', { featureId: ticket.id, status: res.status })
    return { sent: true, statusCode: res.status }
  } catch (err) {
    flog.warn('Ship notification failed', { featureId: ticket.id, error: String(err) })
    return { sent: false, skipped: 'delivery_error' }
  }
}

// ── Helper: resolve caller's project context ─────────────────────────────────
function projectIdFromRequest(c: Context<{ Variables: Variables }>): string | null {
  return (
    c.req.query('project_id') ??
    c.req.header('x-mushi-project-id') ??
    c.req.header('X-Mushi-Project-Id') ??
    null
  )
}

// ── Route factory ─────────────────────────────────────────────────────────────
function featureBoardRoutes() {
  const r = new Hono<{ Variables: Variables }>()
  r.use('*', requireAuth, requireProjectAccess)

  function db() {
    return getServiceClient()
  }

  // ── GET /v1/admin/feature-board ────────────────────────────────────────────
  // Returns all feature tickets for the caller's project, ordered by vote_count
  // desc. Includes whether the current user has already voted.
  r.get('/', async (c) => {
    const userId = c.get('userId') as string
    const projectId = projectIdFromRequest(c)
    if (!projectId) return c.json({ error: 'missing project_id' }, 400)

    const { data: tickets, error } = await db()
      .from('feature_requests_with_stats')
      .select('*')
      .eq('project_id', projectId)
      .order('vote_count', { ascending: false })
      .order('created_at', { ascending: false })

    if (error) {
      flog.error('Failed to fetch feature requests', { error: error.message })
      return c.json({ error: error.message }, 500)
    }

    // Fetch current user's voted request IDs for this project.
    const { data: myVotes } = await db()
      .from('feature_request_votes')
      .select('request_id')
      .eq('user_id', userId)
      .eq('project_id', projectId)

    const myVotedIds = new Set((myVotes ?? []).map((v) => v.request_id))

    return c.json({
      ok: true,
      tickets: (tickets ?? []).map((t) => ({
        ...t,
        my_vote: myVotedIds.has(t.id),
      })),
    })
  })

  // ── GET /v1/admin/feature-board/:id ───────────────────────────────────────
  r.get('/:id', async (c) => {
    const userId = c.get('userId') as string
    const projectId = projectIdFromRequest(c)
    const requestId = c.req.param('id')
    if (!projectId) return c.json({ error: 'missing project_id' }, 400)

    const { data: ticket, error } = await db()
      .from('feature_requests_with_stats')
      .select('*')
      .eq('id', requestId)
      .eq('project_id', projectId)
      .maybeSingle()

    if (error) return c.json({ error: error.message }, 500)
    if (!ticket) return c.json({ error: 'not_found' }, 404)

    const { data: myVote } = await db()
      .from('feature_request_votes')
      .select('id')
      .eq('user_id', userId)
      .eq('request_id', requestId)
      .maybeSingle()

    return c.json({ ok: true, ticket: { ...ticket, my_vote: Boolean(myVote) } })
  })

  // ── POST /v1/admin/feature-board/:id/vote ────────────────────────────────
  // Idempotent toggle: if the user already voted this returns { voted: true }
  // (23505 unique_violation treated as success). If they have voted, this
  // removes the vote instead (toggle behavior).
  r.post('/:id/vote', async (c) => {
    const userId = c.get('userId') as string
    const projectId = projectIdFromRequest(c)
    const requestId = c.req.param('id')
    if (!projectId) return c.json({ error: 'missing project_id' }, 400)

    // Verify the ticket exists and belongs to the project.
    const { data: ticket, error: fetchErr } = await db()
      .from('support_tickets')
      .select('id, project_id, category')
      .eq('id', requestId)
      .eq('project_id', projectId)
      .maybeSingle()

    if (fetchErr) return c.json({ error: fetchErr.message }, 500)
    if (!ticket) return c.json({ error: 'not_found' }, 404)
    if (ticket.category !== 'feature') {
      return c.json({ error: 'only feature tickets can be voted on' }, 400)
    }

    // Check for existing vote (toggle logic).
    const { data: existing } = await db()
      .from('feature_request_votes')
      .select('id')
      .eq('user_id', userId)
      .eq('request_id', requestId)
      .maybeSingle()

    if (existing) {
      // Already voted — remove (toggle off).
      const { error: delErr } = await db()
        .from('feature_request_votes')
        .delete()
        .eq('id', existing.id)
      if (delErr) return c.json({ error: delErr.message }, 500)
      return c.json({ ok: true, voted: false, action: 'removed' })
    }

    // Insert new vote. Catch 23505 (race between concurrent toggles).
    const { error: insErr } = await db().from('feature_request_votes').insert({
      request_id: requestId,
      user_id: userId,
      project_id: projectId,
    })

    if (insErr) {
      // 23505 = unique_violation: another concurrent request already inserted.
      // Treat as "already voted" — idempotent success.
      if (insErr.code === '23505') {
        return c.json({ ok: true, voted: true, action: 'already_voted' })
      }
      flog.error('Vote insert failed', { error: insErr.message })
      return c.json({ error: insErr.message }, 500)
    }

    return c.json({ ok: true, voted: true, action: 'added' })
  })

  // ── GET /v1/admin/feature-board/:id/comments ─────────────────────────────
  r.get('/:id/comments', async (c) => {
    const projectId = projectIdFromRequest(c)
    const requestId = c.req.param('id')
    if (!projectId) return c.json({ error: 'missing project_id' }, 400)

    const { data: comments, error } = await db()
      .from('feature_request_comments')
      .select('id, request_id, author_user_id, author_email, parent_id, body, created_at, updated_at')
      .eq('request_id', requestId)
      .eq('project_id', projectId)
      .order('created_at', { ascending: true })

    if (error) return c.json({ error: error.message }, 500)
    return c.json({ ok: true, comments: comments ?? [] })
  })

  // ── POST /v1/admin/feature-board/:id/comments ────────────────────────────
  r.post('/:id/comments', async (c) => {
    const userId = c.get('userId') as string
    const projectId = projectIdFromRequest(c)
    const requestId = c.req.param('id')
    if (!projectId) return c.json({ error: 'missing project_id' }, 400)

    const body = await c.req.json().catch(() => null)
    const text = (body?.body ?? '').trim()
    const parentId = body?.parent_id ?? null

    if (!text || text.length < 1 || text.length > 3000) {
      return c.json({ error: 'body must be 1–3000 chars' }, 400)
    }

    // Resolve author email from auth.users.
    const { data: userRow } = await db()
      .from('auth.users')
      .select('email')
      .eq('id', userId)
      .maybeSingle()
    const authorEmail = userRow?.email ?? userId

    // Verify ticket exists and belongs to the project.
    const { data: ticket } = await db()
      .from('support_tickets')
      .select('id')
      .eq('id', requestId)
      .eq('project_id', projectId)
      .maybeSingle()
    if (!ticket) return c.json({ error: 'not_found' }, 404)

    const { data: comment, error: insErr } = await db()
      .from('feature_request_comments')
      .insert({
        request_id: requestId,
        project_id: projectId,
        author_user_id: userId,
        author_email: authorEmail,
        parent_id: parentId,
        body: text,
      })
      .select()
      .single()

    if (insErr) return c.json({ error: insErr.message }, 500)
    return c.json({ ok: true, comment }, 201)
  })

  // ── POST /v1/admin/feature-board/:id/ship ───────────────────────────────
  // Marks a feature ticket as shipped and fires a Standard-Webhooks
  // notification using the same HMAC signer as a2a-push-notify,
  // generalized off fix_dispatch_jobs to target any configured push URL.
  // Push URL resolution order:
  //   1. body.push_url (caller-supplied, per-delivery override)
  //   2. vault secret `feature-board/push/<projectId>` (project-scoped)
  //   3. OPERATOR_SLACK_WEBHOOK_URL env var (operator-global fallback)
  //   4. OPERATOR_DISCORD_WEBHOOK_URL env var (operator-global fallback)
  r.post('/:id/ship', async (c) => {
    const projectId = projectIdFromRequest(c)
    const requestId = c.req.param('id')
    if (!projectId) return c.json({ error: 'missing project_id' }, 400)

    const body = await c.req.json().catch(() => null)
    const releaseId: string | null = body?.release_id ?? null
    const note: string | null = body?.note ?? null
    const callerPushUrl: string | null = body?.push_url ?? null

    const { data: ticket, error: fetchErr } = await db()
      .from('support_tickets')
      .select('id, project_id, user_id, user_email, subject, body, category, shipped_in_release_id')
      .eq('id', requestId)
      .eq('project_id', projectId)
      .maybeSingle()

    if (fetchErr) return c.json({ error: fetchErr.message }, 500)
    if (!ticket) return c.json({ error: 'not_found' }, 404)
    if (ticket.category !== 'feature') {
      return c.json({ error: 'only feature tickets can be shipped' }, 400)
    }

    // Update ticket to shipped state.
    const { error: updateErr } = await db()
      .from('support_tickets')
      .update({
        status: 'resolved',
        shipped_in_release_id: releaseId,
        shipped_at: new Date().toISOString(),
        shipped_note: note,
        updated_at: new Date().toISOString(),
      })
      .eq('id', requestId)

    if (updateErr) return c.json({ error: updateErr.message }, 500)

    // Resolve push URL: caller → vault → operator env vars.
    let pushUrl: string | null = callerPushUrl
    if (!pushUrl) {
      const { data: vaultUrl } = await db()
        .rpc('vault_lookup', { secret_name: `feature-board/push/${projectId}` })
      pushUrl = typeof vaultUrl === 'string' ? vaultUrl : null
    }
    if (!pushUrl) {
      pushUrl =
        Deno.env.get('OPERATOR_SLACK_WEBHOOK_URL') ??
        Deno.env.get('OPERATOR_DISCORD_WEBHOOK_URL') ??
        null
    }

    // Resolve signing secret from vault (project-scoped, same namespace as a2a push).
    const { data: vaultSecret } = await db()
      .rpc('vault_lookup', { secret_name: `a2a/push/${projectId}` })
    const pushSecret = typeof vaultSecret === 'string' ? vaultSecret : null

    const notifResult = await fireShippedNotification(
      {
        id: ticket.id,
        project_id: ticket.project_id,
        user_email: ticket.user_email,
        subject: ticket.subject,
        shipped_in_release_id: releaseId,
        shipped_note: note,
      },
      pushUrl,
      pushSecret,
    )

    flog.info('Feature request shipped', {
      requestId,
      projectId,
      releaseId,
      notification: notifResult,
    })

    return c.json({ ok: true, shipped: true, notification: notifResult })
  })

  return r
}

export function registerFeatureBoardRoutes(parent: Hono<{ Variables: Variables }>) {
  parent.route('/v1/admin/feature-board', featureBoardRoutes())
}
