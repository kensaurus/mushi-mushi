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
 *   GET  /v1/cli/projects             (cliTokenAuth) — list user's projects
 *   POST /v1/cli/projects             (cliTokenAuth) — create a project + auto-mint key
 *   POST /v1/cli/projects/:id/keys    (cliTokenAuth) — mint a report:write key for an existing project
 *
 * SECURITY:
 *   - device_code is a random UUID — 128-bit entropy, never shown to the user.
 *   - user_code is 9-char XXXX-XXXX format — low entropy but shown only in
 *     the terminal and the approval page, which already requires the user's
 *     console session (full JWT).
 *   - cli_token_raw stores the raw token temporarily until the first poll
 *     retrieves and nulls it. cli_token_hash allows future request verification.
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
  // Returns device_code (secret, for CLI polling) + user_code (for the user
  // to read aloud/compare) + the browser verification URL.
  app.post('/v1/cli/auth/device/start', async (c) => {
    const db = getServiceClient()
    const userCode = generateUserCode()

    const { data, error } = await db
      .from('cli_auth_requests')
      .insert({
        user_code: userCode,
        ip_hint: c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? null,
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

    const { data: row, error: fetchErr } = await db
      .from('cli_auth_requests')
      .select('id, status, expires_at')
      .eq('user_code', userCode)
      .eq('status', 'pending')
      .gt('expires_at', new Date().toISOString())
      .single()

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

    // No project scope exists at token-issuance time, and audit_logs.project_id
    // is NOT NULL, so a project-scoped audit row can't be written here. Emit a
    // structured log line for observability instead; the subsequent api_key
    // mint (on project create/select) writes the project-scoped audit row.
    try {
      log.info('cli_token.issued', {
        actor_id: userId,
        cli_auth_request_id: row.id,
        ip: c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? undefined,
      })
    } catch {
      // Logging must never block approval.
    }

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

    const db = getServiceClient()
    // Only flip rows that are still pending — never overwrite an already
    // approved/rejected request (idempotent, no-op if nothing matches).
    await db
      .from('cli_auth_requests')
      .update({ status: 'rejected' })
      .eq('user_code', userCode)
      .eq('status', 'pending')

    return c.json({ ok: true, data: { message: 'Request rejected.' } })
  })

  // ─── Poll for token ──────────────────────────────────────────────────────
  // POST /v1/cli/auth/device/token  (public — CLI polls this)
  // Body: { device_code: string }
  // Returns the raw CLI token exactly once (RFC 8628 §3.5). Subsequent polls
  // return an error; caller must persist the token immediately.
  app.post('/v1/cli/auth/device/token', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { device_code?: string }
    const deviceCode = typeof body.device_code === 'string' ? body.device_code.trim() : ''

    if (!deviceCode) {
      return c.json({ error: 'invalid_request', error_description: 'device_code is required' }, 400)
    }

    const db = getServiceClient()
    const { data: row, error } = await db
      .from('cli_auth_requests')
      .select('id, status, user_id, cli_token_raw, expires_at')
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

    if (!cliToken) {
      // Already retrieved — token was nulled by an earlier poll.
      return c.json(
        { error: 'server_error', error_description: 'CLI token was already retrieved. Run: mushi login to get a new one.' },
        400,
      )
    }

    // Atomically claim the one-time token. The `cli_token_raw IS NOT NULL` guard
    // makes the UPDATE itself the lock: under concurrent polls only ONE request
    // flips the column from non-null to null and gets a matched row back; every
    // other concurrent poll re-evaluates the predicate after the row lock clears,
    // sees null, and matches zero rows. This closes the SELECT→UPDATE race where
    // two pollers could both read the same single-use token before it was nulled.
    const { data: claimedRows, error: claimError } = await db
      .from('cli_auth_requests')
      .update({ cli_token_raw: null } as never)
      .eq('id', row.id)
      .not('cli_token_raw', 'is', null)
      .select('id')

    if (claimError || !claimedRows || claimedRows.length === 0) {
      // Lost the race — another concurrent poll already claimed this token.
      return c.json(
        { error: 'server_error', error_description: 'CLI token was already retrieved. Run: mushi login to get a new one.' },
        400,
      )
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

    // Auto-mint a report:write key (same pattern as POST /v1/admin/projects).
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
      scopes: ['report:write'],
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
        { source: 'cli_create_automint', scopes: ['report:write'], key_prefix: prefix },
        { actorType: 'cli' },
      )
    }

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
      scopes: ['report:write'],
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
      { source: 'cli_login_automint', scopes: ['report:write'], key_prefix: prefix },
      { actorType: 'cli' },
    )

    return c.json({ ok: true, data: { key: rawKey, prefix, scopes: ['report:write'] } }, 201)
  })
}
