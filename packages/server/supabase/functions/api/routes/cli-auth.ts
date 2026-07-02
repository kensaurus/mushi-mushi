/**
 * FILE: packages/server/supabase/functions/api/routes/cli-auth.ts
 * PURPOSE: RFC 8628 Device Authorization Grant endpoints for zero-copy-paste
 *          CLI login. Lets the user approve the CLI session in the already-
 *          signed-in console browser; the CLI receives a scoped session token
 *          without the user ever copy-pasting credentials.
 *
 * ENDPOINTS:
 *   POST /v1/cli/auth/device/start    (public)      — start a device-auth session
 *   POST /v1/cli/auth/device/approve  (jwtAuth)     — user approves in the console
 *   POST /v1/cli/auth/device/reject   (jwtAuth)     — user denies in the console
 *   POST /v1/cli/auth/device/token    (public)      — CLI polls for token
 *   GET  /v1/cli/auth/device/status   (jwtAuth)     — approval page polls whether the CLI claimed the token
 *   GET  /v1/cli/projects             (cliTokenAuth) — list user's projects
 *   POST /v1/cli/projects             (cliTokenAuth) — create a project + auto-mint key
 *   POST /v1/cli/projects/:id/keys    (cliTokenAuth) — mint a dual-scope key for an existing project
 *   POST /v1/cli/funnel               (apiKeyAuth)   — emit a CLI funnel event (mcp_setup_done etc.)
 *
 * SECURITY:
 *   - device_code is a random UUID — 128-bit entropy, never shown to the user.
 *   - user_code is 9-char XXXX-XXXX format — low entropy but shown only in
 *     the terminal and the approval page, which already requires the user's
 *     console session (full JWT).
 *   - cli_token_raw stores the raw token temporarily. The first successful
 *     poll stamps cli_token_claimed_at; the token stays re-deliverable to the
 *     same device_code for TOKEN_REDELIVERY_GRACE_MS (a dropped HTTP response
 *     must not permanently strand the CLI), after which it is nulled. Since
 *     device_code is a 128-bit secret only the CLI holds, the grace window
 *     does not widen the attack surface. cli_token_hash allows future request
 *     verification.
 *   - client_id (optional, CLI-persisted random ID) lets /device/start
 *     supersede the same machine's earlier pending requests so a stale
 *     approval tab cannot be approved while the terminal polls a newer code.
 *   - All DB reads/writes use the service role; no anon/authenticated access.
 *   - Expired rows (>10 min) are rejected at the query layer.
 *
 * DEPENDENCIES:
 *   - public.cli_auth_requests  (migration 20260620100000_cli_auth_requests.sql)
 *   - _shared/auth.ts jwtAuth
 *   - _shared/db.ts getServiceClient
 *   - _shared/audit.ts logAudit
 */

import type { Context, Next } from 'npm:hono@4'
import type { Hono } from 'npm:hono@4'
import type { Variables } from '../types.ts'
import { jwtAuth } from '../../_shared/auth.ts'
import { getServiceClient } from '../../_shared/db.ts'
import { logAudit } from '../../_shared/audit.ts'
import { log } from '../../_shared/logger.ts'
import { userCanAccessProject } from '../shared.ts'
import { emitFunnelEvent } from '../../_shared/setup-funnel.ts'
import {
  evaluateTokenDelivery,
  parseClientId,
} from '../../_shared/cli-auth-helpers.ts'

/** Generate a 9-char user-friendly code in the format XXXX-XXXX (RFC 8628 §6.1). */
function generateUserCode(): string {
  // Exclude visually ambiguous characters: 0/O, 1/I, U/V.
  const ALPHABET = 'BCDFGHJKLMNPQRSTVWXYZ23456789'
  // Use a CSPRNG (not Math.random) so user_code values can't be predicted by an
  // attacker trying to race the approval window with a forged code.
  const part = () => {
    const bytes = new Uint8Array(4)
    crypto.getRandomValues(bytes)
    return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('')
  }
  return `${part()}-${part()}`
}

/** SHA-256 hex digest of a string (used for both API keys and CLI tokens). */
async function sha256hex(value: string): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

// ─── Per-IP rate limiting for unauthenticated device-auth endpoints ───────────
//
// /device/start and /device/token are public by RFC 8628 design (the CLI has
// no credentials yet), so they can't be limited by the usual `user_id`-keyed
// `scoped_rate_limit_claim`. We derive a deterministic pseudo-UUID from the
// caller's IP (SHA-256, first 16 bytes formatted as 8-4-4-4-12 hex) and reuse
// the same RPC — `scoped_rate_limits.user_id` was generalized to an opaque
// actor id for exactly this reason (see
// 20260702110000_scoped_rate_limits_generalize_actor.sql, which also fixed a
// live FK-violation bug the same generalization uncovered in
// report_ingest_rate_limit_claim). Postgres's `uuid` type only validates the
// 8-4-4-4-12 hex shape, not RFC 4122 version/variant bits, so a raw hash
// formatted this way is accepted without needing a DB-side hash function.
export function extractClientIp(c: Context): string {
  return (
    c.req.header('cf-connecting-ip') ??
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ??
    // No header at all (e.g. direct-to-origin local dev) — bucket under a
    // shared fallback key rather than skipping the limiter entirely. Never
    // fail open just because the caller's IP couldn't be determined.
    'unknown'
  )
}

export async function ipRateLimitActorId(ip: string, scope: string): Promise<string> {
  // Scope is folded into the hash input (not just the RPC's own `p_scope`
  // column) so the same IP produces unrelated buckets per endpoint —
  // defense in depth in case a future call site reuses a scope string.
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${scope}:${ip}`))
  const hex = Array.from(new Uint8Array(hash).slice(0, 16))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

/**
 * Claim a per-IP rate-limit slot. Returns `null` when the caller is under
 * the cap; returns a ready-to-send 429 response body otherwise. Fails OPEN
 * on an unexpected RPC error (DB hiccup) — an unauthenticated login-start
 * endpoint should not become unusable because the rate-limit backend is
 * briefly unavailable — but logs loudly so the gap is visible in Sentry.
 */
async function claimIpRateLimit(
  db: ReturnType<typeof getServiceClient>,
  ip: string,
  scope: string,
  maxPerWindow: number,
  windowInterval: string,
): Promise<{ retryAfterSeconds: number } | null> {
  const actorId = await ipRateLimitActorId(ip, scope)
  const { error } = await db.rpc('scoped_rate_limit_claim', {
    p_user_id: actorId,
    p_scope: scope,
    p_max_per_window: maxPerWindow,
    p_window: windowInterval,
  })
  if (!error) return null
  if ((error.message ?? '').includes('rate_limit_exceeded')) {
    return { retryAfterSeconds: 60 }
  }
  log.warn('ip rate limit check failed (non-fatal, failing open)', { scope, err: error.message })
  return null
}

// ─── CLI token auth middleware ─────────────────────────────────────────────────

/**
 * Middleware: authenticate a CLI session token issued by the device-auth flow.
 * The CLI sends `Authorization: Bearer <hex>` or `X-Mushi-Cli-Token: <hex>`.
 * We hash it and look up cli_auth_requests by cli_token_hash.
 */
async function cliTokenAuth(c: Context<{ Variables: Variables }>, next: Next): Promise<Response | void> {
  const raw =
    c.req.header('X-Mushi-Cli-Token') ??
    (c.req.header('Authorization') ?? '').replace(/^Bearer\s+/i, '')

  if (!raw) {
    return c.json(
      { ok: false, error: { code: 'MISSING_CLI_TOKEN', message: 'Authorization required. Run: mushi login' } },
      401,
    )
  }

  const db = getServiceClient()
  const tokenHash = await sha256hex(raw)

  const { data: row, error } = await db
    .from('cli_auth_requests')
    .select('user_id, expires_at, status')
    .eq('cli_token_hash', tokenHash)
    .eq('status', 'approved')
    .single()

  if (error || !row || !row.user_id) {
    return c.json(
      { ok: false, error: { code: 'INVALID_CLI_TOKEN', message: 'Invalid or expired CLI token. Run: mushi login' } },
      401,
    )
  }

  if (new Date(row.expires_at) < new Date()) {
    return c.json(
      { ok: false, error: { code: 'EXPIRED_CLI_TOKEN', message: 'CLI token has expired. Run: mushi login' } },
      401,
    )
  }

  c.set('userId', row.user_id)
  await next()
}

// ─── Route registration ────────────────────────────────────────────────────────

export function registerCliAuthRoutes(app: Hono<{ Variables: Variables }>): void {
  // ─── Start device-auth ───────────────────────────────────────────────────
  // POST /v1/cli/auth/device/start  (public)
  // Body: { client_id?: string } — optional per-machine CLI identifier.
  // Returns device_code (secret, for CLI polling) + user_code (for the user
  // to read aloud/compare) + the browser verification URL.
  app.post('/v1/cli/auth/device/start', async (c) => {
    const db = getServiceClient()
    const ip = extractClientIp(c)

    // 20 session-starts per 10 minutes per IP. Generous for a dev re-running
    // a Ctrl+C'd wizard several times, but blocks scripted mass-creation of
    // cli_auth_requests rows (each mints a device_code + user_code and fires
    // a funnel event — cheap individually, but free to spam without this).
    const rateMiss = await claimIpRateLimit(db, ip, 'cli_device_auth_start', 20, '10 minutes')
    if (rateMiss) {
      c.header('Retry-After', String(rateMiss.retryAfterSeconds))
      return c.json(
        { ok: false, error: { code: 'RATE_LIMITED', message: 'Too many sign-in attempts from this network. Try again shortly.' } },
        429,
      )
    }

    const userCode = generateUserCode()

    const body = (await c.req.json().catch(() => ({}))) as { client_id?: string }
    const clientId = parseClientId(body.client_id)

    // Supersede this machine's earlier pending requests. A Ctrl+C'd or re-run
    // wizard leaves its previous row approvable for the full 10-minute TTL;
    // if the user then clicks Approve in the OLD browser tab, the page says
    // "CLI connected!" while the terminal polls a different device_code
    // forever. Expiring the stale rows up front makes the old tab fail loudly
    // instead of approving a session nobody is polling.
    if (clientId) {
      await db
        .from('cli_auth_requests')
        .update({ status: 'expired' })
        .eq('client_id', clientId)
        .eq('status', 'pending')
    }

    const { data, error } = await db
      .from('cli_auth_requests')
      .insert({
        user_code: userCode,
        client_id: clientId,
        ip_hint: ip === 'unknown' ? null : ip,
      })
      .select('device_code, expires_at')
      .single()

    if (error || !data) {
      return c.json(
        { ok: false, error: { code: 'DB_ERROR', message: 'Could not start device auth' } },
        500,
      )
    }

    // The console approval page URL — user_code pre-fills the field.
    const adminOrigin =
      (Deno.env.get('MUSHI_ADMIN_ORIGIN_ALLOWLIST') ?? '').split(',')[0]?.trim() ||
      'https://kensaur.us'
    const verificationUri = `${adminOrigin}/mushi-mushi/admin/cli-auth?code=${userCode}`

    // Fire-and-forget: record that a CLI auth attempt started. No user_id yet
    // (public endpoint) so deduplicate on device_code alone.
    void emitFunnelEvent(db, {
      userId: null,
      eventName: 'cli_auth_started',
      dedupKey: data.device_code,
      source: 'cli',
      metadata: { user_code: userCode },
    })

    return c.json({
      ok: true,
      data: {
        device_code: data.device_code,
        user_code: userCode,
        verification_uri: verificationUri,
        expires_in: 600, // seconds
        interval: 5,     // poll every 5 s
      },
    })
  })

  // ─── Approve device-auth ─────────────────────────────────────────────────
  // POST /v1/cli/auth/device/approve  (jwtAuth — console user must be signed in)
  // Body: { user_code: string }
  // Mints a CLI session token, stores hash + raw (raw nulled after first poll).
  // Returns nothing actionable to the console UI; CLI polls /token for the raw.
  app.post('/v1/cli/auth/device/approve', jwtAuth, async (c) => {
    const userId = c.get('userId') as string
    const body = (await c.req.json().catch(() => ({}))) as { user_code?: string }
    const userCode = typeof body.user_code === 'string' ? body.user_code.trim().toUpperCase() : ''

    if (!userCode) {
      return c.json(
        { ok: false, error: { code: 'MISSING_USER_CODE', message: 'user_code is required' } },
        400,
      )
    }

    const db = getServiceClient()

    // Newest-first + limit(1), matching /device/status. user_code collisions
    // across concurrent sessions are astronomically unlikely, but `.single()`
    // throws on >1 match — a defensive `.maybeSingle()` + ordering means a
    // rare duplicate degrades to "approve the live one" instead of a hard
    // 500/PGRST116 for the user.
    const { data: row, error: fetchErr } = await db
      .from('cli_auth_requests')
      .select('id, status, expires_at')
      .eq('user_code', userCode)
      .eq('status', 'pending')
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (fetchErr || !row) {
      return c.json(
        { ok: false, error: { code: 'NOT_FOUND', message: 'No pending request for that code, or it has expired' } },
        404,
      )
    }

    // Mint a CLI session token (32 random bytes → 64-char hex).
    const rawTokenBytes = new Uint8Array(32)
    crypto.getRandomValues(rawTokenBytes)
    const rawToken = Array.from(rawTokenBytes).map((b) => b.toString(16).padStart(2, '0')).join('')
    const tokenHash = await sha256hex(rawToken)

    const { error: updateErr } = await db
      .from('cli_auth_requests')
      .update({
        status: 'approved',
        user_id: userId,
        cli_token_hash: tokenHash,
        // Store raw token temporarily so /token poll can retrieve it exactly once.
        cli_token_raw: rawToken,
      })
      .eq('id', row.id)

    if (updateErr) {
      return c.json(
        { ok: false, error: { code: 'DB_ERROR', message: 'Could not approve request' } },
        500,
      )
    }

    // Structured log + funnel event — neither must block the approval response.
    try {
      log.info('cli_token.issued', {
        actor_id: userId,
        cli_auth_request_id: row.id,
        ip: c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? undefined,
      })
    } catch {
      // Logging must never block approval.
    }

    void emitFunnelEvent(db, {
      userId,
      eventName: 'cli_auth_approved',
      dedupKey: row.id,
      source: 'console',
    })

    return c.json({ ok: true, data: { message: 'Approved — your CLI will connect in a moment.' } })
  })

  // ─── Reject device-auth ──────────────────────────────────────────────────
  // POST /v1/cli/auth/device/reject  (jwtAuth — console user must be signed in)
  // Body: { user_code: string }
  // Marks the request rejected so the CLI's next poll returns access_denied
  // immediately instead of hanging until the 10-minute expiry.
  app.post('/v1/cli/auth/device/reject', jwtAuth, async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { user_code?: string }
    const userCode = typeof body.user_code === 'string' ? body.user_code.trim().toUpperCase() : ''

    if (!userCode) {
      return c.json(
        { ok: false, error: { code: 'MISSING_USER_CODE', message: 'user_code is required' } },
        400,
      )
    }

    const userId = c.get('userId') as string
    const db = getServiceClient()
    // Only flip rows that are still pending — never overwrite an already
    // approved/rejected request (idempotent, no-op if nothing matches).
    const { data: rejectedRow } = await db
      .from('cli_auth_requests')
      .update({ status: 'rejected' })
      .eq('user_code', userCode)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle()

    if (rejectedRow?.id) {
      void emitFunnelEvent(db, {
        userId,
        eventName: 'cli_auth_denied',
        dedupKey: rejectedRow.id,
        source: 'console',
      })
    }

    return c.json({ ok: true, data: { message: 'Request rejected.' } })
  })

  // ─── Poll for token ──────────────────────────────────────────────────────
  // POST /v1/cli/auth/device/token  (public — CLI polls this)
  // Body: { device_code: string }
  // Two-phase claim: the first successful delivery stamps cli_token_claimed_at
  // but leaves the raw token re-deliverable to the same device_code for
  // TOKEN_REDELIVERY_GRACE_MS, so a dropped HTTP response doesn't turn into a
  // terminal invalid_grant. After the grace window the raw token is nulled.
  app.post('/v1/cli/auth/device/token', async (c) => {
    const db = getServiceClient()
    const ip = extractClientIp(c)

    // RFC 8628 §3.5: a client polling faster than the advertised `interval`
    // (5s here) should get `slow_down`, not silence. 40/minute per IP covers
    // several concurrent device-auth flows behind the same NAT/office IP at
    // the advertised cadence (12/min each) with headroom, while still
    // blocking a tight poll loop that ignores `interval` or brute-forces
    // device_code guesses (128-bit secret, so guessing is infeasible either
    // way — this is about protecting the DB from a busted/malicious client).
    const rateMiss = await claimIpRateLimit(db, ip, 'cli_device_auth_token', 40, '1 minute')
    if (rateMiss) {
      c.header('Retry-After', String(rateMiss.retryAfterSeconds))
      return c.json({ error: 'slow_down', error_description: 'Polling too frequently — slow down.' }, 429)
    }

    const body = (await c.req.json().catch(() => ({}))) as { device_code?: string }
    const deviceCode = typeof body.device_code === 'string' ? body.device_code.trim() : ''

    if (!deviceCode) {
      return c.json({ error: 'invalid_request', error_description: 'device_code is required' }, 400)
    }
    const { data: row, error } = await db
      .from('cli_auth_requests')
      .select('id, status, user_id, cli_token_raw, cli_token_claimed_at, expires_at')
      .eq('device_code', deviceCode)
      .single()

    if (error || !row) {
      return c.json({ error: 'invalid_grant', error_description: 'device_code not found' }, 400)
    }

    if (row.status === 'expired' || new Date(row.expires_at) < new Date()) {
      return c.json(
        { error: 'expired_token', error_description: 'The device code has expired. Run: mushi login' },
        400,
      )
    }
    if (row.status === 'rejected') {
      return c.json(
        { error: 'access_denied', error_description: 'The request was rejected in the console.' },
        400,
      )
    }
    if (row.status === 'pending') {
      return c.json(
        { error: 'authorization_pending', error_description: 'Waiting for browser approval.' },
        400,
      )
    }

    // status === 'approved'
    const cliToken = (row as Record<string, unknown>).cli_token_raw as string | null
    const claimedAtRaw = (row as Record<string, unknown>).cli_token_claimed_at as string | null
    const delivery = evaluateTokenDelivery(
      { cli_token_raw: cliToken, cli_token_claimed_at: claimedAtRaw },
      Date.now(),
    )

    if (delivery.action === 'invalid_grant') {
      if (delivery.reason === 'grace_elapsed' && cliToken) {
        await db
          .from('cli_auth_requests')
          .update({ cli_token_raw: null } as never)
          .eq('id', row.id)
      }
      return c.json(
        { error: 'invalid_grant', error_description: 'CLI token was already retrieved. Run: mushi login to get a new one.' },
        400,
      )
    }

    if (delivery.firstClaim) {
      // First delivery — stamp claimed_at atomically. The `IS NULL` guard makes
      // the UPDATE the lock: under concurrent polls only one request stamps it,
      // but losing that race is harmless (the loser is the same device_code
      // holder and still gets the token below, inside the grace window).
      const { error: claimError } = await db
        .from('cli_auth_requests')
        .update({ cli_token_claimed_at: new Date().toISOString() } as never)
        .eq('id', row.id)
        .is('cli_token_claimed_at', null)

      if (claimError) {
        // The UPDATE itself failed (DB hiccup). Signal 5xx so the CLI treats it
        // as retryable and keeps polling instead of giving up.
        return c.json(
          { error: 'server_error', error_description: 'Could not claim the CLI token; please retry.' },
          500,
        )
      }

      // Emit token-claimed funnel event once, on first delivery.
      if (row.user_id) {
        void emitFunnelEvent(db, {
          userId: row.user_id,
          eventName: 'cli_auth_token_claimed',
          dedupKey: row.id,
          source: 'cli',
        })
      }
    }

    return c.json({
      ok: true,
      data: {
        cli_token: cliToken,
        user_id: row.user_id,
        token_type: 'bearer',
      },
    })
  })

  // ─── Claim status (approval page) ─────────────────────────────────────────
  // GET /v1/cli/auth/device/status?user_code=XXXX-XXXX  (jwtAuth)
  // Lets the approval page verify the terminal actually picked the token up
  // before declaring "CLI connected!". Looks up the newest request for the
  // code so superseded/expired duplicates never mask the live one.
  app.get('/v1/cli/auth/device/status', jwtAuth, async (c) => {
    const userCode = (c.req.query('user_code') ?? '').trim().toUpperCase()
    if (!userCode) {
      return c.json(
        { ok: false, error: { code: 'MISSING_USER_CODE', message: 'user_code is required' } },
        400,
      )
    }

    const db = getServiceClient()
    const { data: row } = await db
      .from('cli_auth_requests')
      .select('status, cli_token_claimed_at, expires_at')
      .eq('user_code', userCode)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!row) {
      return c.json(
        { ok: false, error: { code: 'NOT_FOUND', message: 'No request found for that code' } },
        404,
      )
    }

    const expired = row.status === 'expired' || new Date(row.expires_at) < new Date()
    return c.json({
      ok: true,
      data: {
        status: expired ? 'expired' : row.status,
        claimed: (row as Record<string, unknown>).cli_token_claimed_at != null,
      },
    })
  })

  // ─── List projects (CLI authenticated) ──────────────────────────────────
  // GET /v1/cli/projects  (cliTokenAuth)
  app.get('/v1/cli/projects', cliTokenAuth, async (c) => {
    const userId = c.get('userId') as string
    const db = getServiceClient()

    const { data: memberships } = await db
      .from('organization_members')
      .select('organization_id, role')
      .eq('user_id', userId)

    const writableOrgIds = (memberships ?? [])
      .filter((m) => m.role === 'owner' || m.role === 'admin')
      .map((m) => m.organization_id)

    if (!writableOrgIds.length) {
      return c.json({ ok: true, data: { projects: [] } })
    }

    const { data: projects } = await db
      .from('projects')
      .select('id, name, slug, created_at')
      .in('organization_id', writableOrgIds)
      .order('created_at', { ascending: false })
      .limit(50)

    return c.json({ ok: true, data: { projects: projects ?? [] } })
  })

  // ─── Create project (CLI authenticated) ─────────────────────────────────
  // POST /v1/cli/projects  (cliTokenAuth)
  // Same auto-mint pattern as POST /v1/admin/projects.
  app.post('/v1/cli/projects', cliTokenAuth, async (c) => {
    const userId = c.get('userId') as string
    const body = (await c.req.json().catch(() => ({}))) as { name?: string }
    const name = typeof body.name === 'string' ? body.name.trim() : ''

    if (!name) {
      return c.json(
        { ok: false, error: { code: 'VALIDATION_ERROR', message: 'name is required' } },
        400,
      )
    }

    const db = getServiceClient()

    const { data: memberships } = await db
      .from('organization_members')
      .select('organization_id, role, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: true })

    const writable = (memberships ?? []).find((m) => m.role === 'owner' || m.role === 'admin')
    let organizationId = writable?.organization_id ?? null

    if (!organizationId) {
      const { data: personalOrgId } = await db.rpc('bootstrap_personal_org', { p_user_id: userId })
      if (typeof personalOrgId === 'string') organizationId = personalOrgId
    }

    if (!organizationId) {
      return c.json(
        { ok: false, error: { code: 'NO_ORGANIZATION', message: 'No writable team found. Visit the console to create a team first.' } },
        400,
      )
    }

    let slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48)
    if (!slug) slug = `project-${crypto.randomUUID().slice(0, 8)}`

    const { data, error } = await db
      .from('projects')
      .insert({ name, slug, owner_id: userId, organization_id: organizationId })
      .select('id')
      .single()

    if (error) {
      return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 500)
    }

    await db.from('project_settings').insert({ project_id: data.id })
    await db.from('project_members').upsert(
      { project_id: data.id, user_id: userId, role: 'owner' },
      { onConflict: 'project_id,user_id' },
    )

    // Mint a full CLI key: report:write (SDK ingest) + mcp:read + mcp:write
    // (CLI admin + MCP tools). mcp:write is required by owner-only admin commands
    // such as `mushi billing cap`, `mushi billing alert-email`, `mushi pipeline
    // start`, and `mushi fixes merge`. mcp:write implies mcp:read at the gate, but
    // both are listed for explicit auditability. This endpoint is owner-gated, so
    // the key never carries more than the authenticated owner already has.
    const WIZARD_SCOPES = ['report:write', 'mcp:read', 'mcp:write'] as const
    const rawKey = `mushi_${crypto.randomUUID().replace(/-/g, '')}`
    const prefix = rawKey.slice(0, 12)
    const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rawKey))
    const keyHash = Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
    const keyId = crypto.randomUUID()

    let apiKey: string | null = null
    const { error: keyErr } = await db.from('project_api_keys').insert({
      id: keyId,
      project_id: data.id,
      key_hash: keyHash,
      key_prefix: prefix,
      label: 'sdk-ingest',
      scopes: WIZARD_SCOPES,
      is_active: true,
    })
    if (!keyErr) {
      apiKey = rawKey
      void logAudit(
        db,
        data.id,
        userId,
        'api_key.created',
        'project_api_key',
        keyId,
        { source: 'cli_create_automint', scopes: WIZARD_SCOPES, key_prefix: prefix },
        { actorType: 'cli' },
      )
      void emitFunnelEvent(db, {
        userId,
        projectId: data.id,
        eventName: 'cli_key_minted',
        dedupKey: keyId,
        source: 'cli',
        metadata: { key_prefix: prefix, scopes: WIZARD_SCOPES },
      })
    }

    void emitFunnelEvent(db, {
      userId,
      projectId: data.id,
      eventName: 'cli_project_created',
      dedupKey: data.id,
      source: 'cli',
      metadata: { project_name: name },
    })

    return c.json({ ok: true, data: { id: data.id, slug, name, apiKey, keyPrefix: prefix } }, 201)
  })

  // ─── Mint a report:write key for an existing project (CLI authenticated) ──
  // POST /v1/cli/projects/:id/keys  (cliTokenAuth)
  // Used by `mushi login` when the user SELECTS an existing project (raw keys
  // can't be recovered, so we mint a fresh scoped key). Mirrors the
  // owner/admin gate of POST /v1/admin/projects/:id/keys, but accepts the CLI
  // device-auth token instead of a JWT.
  app.post('/v1/cli/projects/:id/keys', cliTokenAuth, async (c) => {
    const userId = c.get('userId') as string
    const projectId = c.req.param('id')!
    const db = getServiceClient()

    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (!UUID_RE.test(projectId)) {
      return c.json(
        { ok: false, error: { code: 'INVALID_PROJECT_ID', message: 'Project id must be a UUID' } },
        400,
      )
    }

    // Minting keys is owner/admin-only — same gate as the admin endpoint.
    const access = await userCanAccessProject(db, userId, projectId)
    if (!access.allowed) {
      return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Project not found' } }, 404)
    }
    if (access.role !== 'owner' && access.role !== 'admin') {
      return c.json(
        { ok: false, error: { code: 'FORBIDDEN', message: 'Owner or admin access required' } },
        403,
      )
    }

    // Mint a full CLI key matching the project-create flow: report:write +
    // mcp:read + mcp:write. mcp:write powers owner-only admin commands (billing
    // cap / alert-email, pipeline start, fixes merge). Owner/admin-gated above,
    // so the key never exceeds the caller's existing privileges.
    const LOGIN_SCOPES = ['report:write', 'mcp:read', 'mcp:write'] as const
    const rawKey = `mushi_${crypto.randomUUID().replace(/-/g, '')}`
    const prefix = rawKey.slice(0, 12)
    const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rawKey))
    const keyHash = Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
    const keyId = crypto.randomUUID()

    const { error: keyErr } = await db.from('project_api_keys').insert({
      id: keyId,
      project_id: projectId,
      key_hash: keyHash,
      key_prefix: prefix,
      label: 'cli-login',
      scopes: LOGIN_SCOPES,
      is_active: true,
    })
    if (keyErr) {
      return c.json({ ok: false, error: { code: 'DB_ERROR', message: keyErr.message } }, 500)
    }

    void logAudit(
      db,
      projectId,
      userId,
      'api_key.created',
      'project_api_key',
      keyId,
      { source: 'cli_login_automint', scopes: LOGIN_SCOPES, key_prefix: prefix },
      { actorType: 'cli' },
    )

    void emitFunnelEvent(db, {
      userId,
      projectId,
      eventName: 'cli_key_minted',
      dedupKey: keyId,
      source: 'cli',
      metadata: { key_prefix: prefix, scopes: LOGIN_SCOPES },
    })

    return c.json({ ok: true, data: { key: rawKey, prefix, scopes: LOGIN_SCOPES } }, 201)
  })

  // ─── CLI funnel signal (authenticated with API key) ───────────────────────
  // POST /v1/cli/funnel  (apiKeyAuth via X-Mushi-Api-Key header)
  // Lightweight fire-and-forget endpoint so the CLI can emit funnel events
  // (e.g. mcp_setup_done) using its API key rather than requiring a browser
  // session. Accepts any valid project API key (no specific scope required —
  // the key proves project membership, and the event is the signal itself).
  //
  // Body: { event: FunnelEventName, source?: string, metadata?: object }
  app.post('/v1/cli/funnel', async (c) => {
    const apiKey = c.req.header('X-Mushi-Api-Key') ?? c.req.header('Authorization')?.replace(/^Bearer /, '')
    const projectId = c.req.header('X-Mushi-Project') ?? ''

    if (!apiKey) {
      return c.json({ ok: false, error: { code: 'UNAUTHORIZED', message: 'API key required' } }, 401)
    }

    const db = getServiceClient()

    // Resolve the key by its hash ONLY. NEVER match on key_prefix — the prefix
    // is non-secret (it is rendered in dashboards, audit logs, and CLI output),
    // so a prefix match would let any caller who knows the public 12-char prefix
    // authenticate without the secret. Mirrors the canonical apiKeyAuth lookup.
    const keyHash = await sha256hex(apiKey)
    const { data: keyRow, error: keyErr } = await db
      .from('project_api_keys')
      .select('id, project_id, is_active')
      .eq('key_hash', keyHash)
      .maybeSingle()

    if (keyErr || !keyRow || !keyRow.is_active) {
      return c.json({ ok: false, error: { code: 'UNAUTHORIZED', message: 'Invalid or inactive API key' } }, 401)
    }
    if (projectId && keyRow.project_id !== projectId) {
      return c.json({ ok: false, error: { code: 'FORBIDDEN', message: 'Project mismatch' } }, 403)
    }

    let body: { event?: string; source?: string; metadata?: Record<string, unknown> } = {}
    try { body = await c.req.json() } catch { /* ignore — body is optional */ }

    const allowedEvents = ['mcp_setup_done', 'mcp_first_tool_call'] as const
    type AllowedEvent = typeof allowedEvents[number]
    const eventName = body.event as AllowedEvent | undefined

    if (!eventName || !allowedEvents.includes(eventName)) {
      return c.json({ ok: false, error: { code: 'INVALID_EVENT', message: `Event must be one of: ${allowedEvents.join(', ')}` } }, 400)
    }

    const dedupKey = `${keyRow.id}:${eventName}`
    void emitFunnelEvent(db, {
      userId: null,
      projectId: keyRow.project_id,
      eventName,
      dedupKey,
      source: 'cli',
      metadata: body.metadata ?? {},
    })

    return c.json({ ok: true })
  })
}
