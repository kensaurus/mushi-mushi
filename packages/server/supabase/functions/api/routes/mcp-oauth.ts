/**
 * FILE: packages/server/supabase/functions/api/routes/mcp-oauth.ts
 * PURPOSE: Real OAuth 2.1 authorization-code (+ PKCE) endpoints for the hosted
 *          MCP server, so MCP clients that speak the MCP auth spec — Claude
 *          Code's `/mcp` login, Cursor, VS Code — can connect without hand-
 *          copying an API key. The access token IS a normal project API key
 *          (label 'mcp-oauth'): validated by the same `project_api_keys`
 *          lookup as every other key and revocable from the console Keys page.
 *
 * ENDPOINTS:
 *   POST /v1/mcp-oauth/register   (public)  — RFC 7591 dynamic client registration
 *   GET  /v1/mcp-oauth/authorize  (public)  — validates + 302 to console consent page
 *   POST /v1/mcp-oauth/token      (public)  — code + PKCE verifier → project API key
 *   GET  /v1/mcp-oauth/request    (jwtAuth) — consent page reads the pending transaction
 *   POST /v1/mcp-oauth/approve    (jwtAuth) — owner/admin approves, mints key, returns redirect
 *   POST /v1/mcp-oauth/deny       (jwtAuth) — returns error redirect for the client
 *
 * The mcp edge function's `${issuer}/oauth/*` endpoints delegate here (the
 * AS metadata advertises the mcp-function URLs; that function redirects
 * GET /oauth/authorize and proxies POST /oauth/register|token to these
 * routes) so the issuer never changes while the logic lives with the rest of
 * the Hono API surface.
 *
 * SECURITY:
 *   - PKCE S256 is mandatory; `plain` and missing challenges are rejected.
 *   - redirect_uri: https or loopback http only (RFC 8252); exact match against
 *     the registered URI, with the RFC 8252 §7.3 loopback-port allowance.
 *   - Authorization codes are 32 random bytes; only the SHA-256 is stored
 *     after issuance. Single-use with a short redelivery grace window
 *     (evaluateTokenDelivery — same semantics as the CLI device flow).
 *   - Approval requires a signed-in console user with owner/admin on the
 *     selected project; the minted key never exceeds the approver's access.
 *   - All public endpoints are per-IP rate-limited via scoped_rate_limit_claim.
 */

import type { Hono } from 'npm:hono@4'
import type { Variables } from '../types.ts'
import { jwtAuth } from '../../_shared/auth.ts'
import { getServiceClient } from '../../_shared/db.ts'
import { logAudit } from '../../_shared/audit.ts'
import { log } from '../../_shared/logger.ts'
import { userCanAccessProject } from '../shared.ts'
import { claimIpRateLimit, extractClientIp } from './cli-auth.ts'
import { evaluateTokenDelivery } from '../../_shared/cli-auth-helpers.ts'
import {
  appendRedirectParams,
  grantedScopeString,
  isAllowedRedirectUri,
  mapOAuthScopeToKeyScopes,
  readOAuthParams,
  verifyPkceS256,
} from '../../_shared/mcp-oauth-helpers.ts'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function sha256hex(value: string): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/** RFC 6749 §5.2 error body. */
function oauthError(error: string, description: string): { error: string; error_description: string } {
  return { error, error_description: description }
}

/**
 * Exact redirect_uri match, plus the RFC 8252 §7.3 allowance: for loopback
 * hosts the PORT may differ from the registered URI (native apps bind an
 * ephemeral port per session), but scheme, host, and path must still match.
 */
export function redirectUriMatches(registered: string, presented: string): boolean {
  if (registered === presented) return true
  let a: URL, b: URL
  try {
    a = new URL(registered)
    b = new URL(presented)
  } catch {
    return false
  }
  const loopback = (u: URL) => u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '::1'
  return (
    a.protocol === 'http:' && b.protocol === 'http:' &&
    loopback(a) && loopback(b) &&
    a.hostname === b.hostname &&
    a.pathname === b.pathname
  )
}

function consentPageUrl(txnId: string): string {
  const adminOrigin =
    (Deno.env.get('MUSHI_ADMIN_ORIGIN_ALLOWLIST') ?? '').split(',')[0]?.trim() ||
    'https://kensaur.us'
  return `${adminOrigin}/mushi-mushi/admin/mcp-auth?txn=${txnId}`
}

export function registerMcpOauthRoutes(app: Hono<{ Variables: Variables }>): void {
  // ─── RFC 7591 dynamic client registration ─────────────────────────────────
  // POST /v1/mcp-oauth/register  (public)
  // Public clients only (token_endpoint_auth_method 'none'); PKCE carries the
  // proof-of-possession, so no client_secret is issued.
  app.post('/v1/mcp-oauth/register', async (c) => {
    const db = getServiceClient()
    const ip = extractClientIp(c)
    const rateMiss = await claimIpRateLimit(db, ip, 'mcp_oauth_register', 20, '10 minutes')
    if (rateMiss) {
      c.header('Retry-After', String(rateMiss.retryAfterSeconds))
      return c.json(oauthError('temporarily_unavailable', 'Too many registrations from this network. Try again shortly.'), 429)
    }

    const body = (await c.req.json().catch(() => ({}))) as {
      redirect_uris?: unknown
      client_name?: unknown
    }
    const redirectUris = Array.isArray(body.redirect_uris)
      ? body.redirect_uris.filter((u): u is string => typeof u === 'string')
      : []
    if (redirectUris.length === 0 || redirectUris.length > 10) {
      return c.json(oauthError('invalid_redirect_uri', 'redirect_uris must contain 1–10 URIs'), 400)
    }
    for (const uri of redirectUris) {
      if (uri.length > 2000 || !isAllowedRedirectUri(uri)) {
        return c.json(
          oauthError('invalid_redirect_uri', `Not an acceptable redirect URI (https or loopback http required): ${uri.slice(0, 200)}`),
          400,
        )
      }
    }
    const clientName =
      typeof body.client_name === 'string' && body.client_name.trim()
        ? body.client_name.trim().slice(0, 128)
        : null

    const { data, error } = await db
      .from('mcp_oauth_clients')
      .insert({ client_name: clientName, redirect_uris: redirectUris })
      .select('client_id, created_at')
      .single()
    if (error || !data) {
      return c.json(oauthError('server_error', 'Could not register client'), 500)
    }

    return c.json(
      {
        client_id: data.client_id,
        client_name: clientName ?? undefined,
        redirect_uris: redirectUris,
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code'],
        response_types: ['code'],
        client_id_issued_at: Math.floor(new Date(data.created_at).getTime() / 1000),
      },
      201,
    )
  })

  // ─── Authorization endpoint ───────────────────────────────────────────────
  // GET /v1/mcp-oauth/authorize  (public — the user's browser lands here)
  // Validates the request and 302s to the console consent page. Per RFC 6749
  // §4.1.2.1 an invalid client_id/redirect_uri gets a 400 (NEVER a redirect —
  // that would make us an open redirector); other errors redirect back to the
  // client with ?error=.
  app.get('/v1/mcp-oauth/authorize', async (c) => {
    const db = getServiceClient()
    const ip = extractClientIp(c)
    const rateMiss = await claimIpRateLimit(db, ip, 'mcp_oauth_authorize', 30, '10 minutes')
    if (rateMiss) {
      c.header('Retry-After', String(rateMiss.retryAfterSeconds))
      return c.json(oauthError('temporarily_unavailable', 'Too many authorization attempts. Try again shortly.'), 429)
    }

    const q = (name: string) => (c.req.query(name) ?? '').trim()
    const clientId = q('client_id')
    const redirectUri = q('redirect_uri')

    if (!UUID_RE.test(clientId)) {
      return c.json(oauthError('invalid_client', 'Unknown client_id. Register first: POST /oauth/register'), 400)
    }
    const { data: client } = await db
      .from('mcp_oauth_clients')
      .select('client_id, client_name, redirect_uris')
      .eq('client_id', clientId)
      .maybeSingle()
    if (!client) {
      return c.json(oauthError('invalid_client', 'Unknown client_id. Register first: POST /oauth/register'), 400)
    }
    if (!redirectUri || !(client.redirect_uris as string[]).some((r) => redirectUriMatches(r, redirectUri))) {
      return c.json(oauthError('invalid_redirect_uri', 'redirect_uri does not match a registered URI for this client'), 400)
    }

    // From here on the redirect_uri is trusted — report errors to the client.
    const state = q('state') || null
    const fail = (error: string, description: string) =>
      c.redirect(appendRedirectParams(redirectUri, { error, error_description: description, state }), 302)

    if (q('response_type') !== 'code') {
      return fail('unsupported_response_type', 'Only response_type=code is supported')
    }
    const codeChallenge = q('code_challenge')
    const method = q('code_challenge_method') || 'S256'
    if (!codeChallenge || method !== 'S256') {
      return fail('invalid_request', 'PKCE with code_challenge_method=S256 is required')
    }

    const { data: txn, error: insertErr } = await db
      .from('mcp_oauth_requests')
      .insert({
        client_id: clientId,
        redirect_uri: redirectUri,
        state,
        scope: q('scope') || null,
        resource: q('resource') || null,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        ip_hint: ip === 'unknown' ? null : ip,
      })
      .select('id')
      .single()
    if (insertErr || !txn) {
      return fail('server_error', 'Could not start the authorization request')
    }

    return c.redirect(consentPageUrl(txn.id), 302)
  })

  // ─── Consent page: read the pending transaction ───────────────────────────
  // GET /v1/mcp-oauth/request?txn=<uuid>  (jwtAuth)
  app.get('/v1/mcp-oauth/request', jwtAuth, async (c) => {
    const userId = c.get('userId') as string
    const txn = (c.req.query('txn') ?? '').trim()
    if (!UUID_RE.test(txn)) {
      return c.json({ ok: false, error: { code: 'INVALID_TXN', message: 'txn must be a UUID' } }, 400)
    }
    const db = getServiceClient()
    // Bind the pending transaction to the first authenticated viewer — the
    // console user who followed the /authorize 302 into their own logged-in
    // session. Without this, any signed-in user who learns/guesses the txn
    // UUID could read the client name, scope, and redirect host (info leak) or
    // deny it (DoS). The claim only fires while pending + unclaimed; once bound,
    // only that user may read, approve, or deny it.
    await db
      .from('mcp_oauth_requests')
      .update({ user_id: userId })
      .eq('id', txn)
      .eq('status', 'pending')
      .is('user_id', null)
    const { data: row } = await db
      .from('mcp_oauth_requests')
      .select('id, status, scope, redirect_uri, expires_at, user_id, mcp_oauth_clients ( client_name )')
      .eq('id', txn)
      .maybeSingle()
    if (!row) {
      return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'No authorization request found — it may have expired.' } }, 404)
    }
    // Bound to a different console user (lost the claim race, or someone else's
    // transaction). Return the same NOT_FOUND as a missing txn — never confirm
    // that another user's transaction exists.
    if (row.user_id && row.user_id !== userId) {
      return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'No authorization request found — it may have expired.' } }, 404)
    }
    const expired = row.status === 'pending' && new Date(row.expires_at) < new Date()
    const clientJoin = row.mcp_oauth_clients as { client_name: string | null } | Array<{ client_name: string | null }> | null
    const clientName = Array.isArray(clientJoin) ? clientJoin[0]?.client_name : clientJoin?.client_name
    return c.json({
      ok: true,
      data: {
        status: expired ? 'expired' : row.status,
        client_name: clientName ?? 'Unnamed MCP client',
        scope: row.scope,
        granted_key_scopes: mapOAuthScopeToKeyScopes(row.scope),
        redirect_host: (() => {
          try { return new URL(row.redirect_uri).host || row.redirect_uri } catch { return row.redirect_uri }
        })(),
        expires_at: row.expires_at,
      },
    })
  })

  // ─── Approve ──────────────────────────────────────────────────────────────
  // POST /v1/mcp-oauth/approve  (jwtAuth)
  // Body: { txn: uuid, project_id: uuid }
  // Mints a project API key scoped from the requested OAuth scope, stamps the
  // authorization code, and hands the consent page the client redirect.
  app.post('/v1/mcp-oauth/approve', jwtAuth, async (c) => {
    const userId = c.get('userId') as string
    const body = (await c.req.json().catch(() => ({}))) as { txn?: string; project_id?: string }
    const txn = typeof body.txn === 'string' ? body.txn.trim() : ''
    const projectId = typeof body.project_id === 'string' ? body.project_id.trim() : ''
    if (!UUID_RE.test(txn) || !UUID_RE.test(projectId)) {
      return c.json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'txn and project_id must be UUIDs' } }, 400)
    }

    const db = getServiceClient()
    const { data: row } = await db
      .from('mcp_oauth_requests')
      .select('id, status, scope, redirect_uri, state, expires_at, user_id')
      .eq('id', txn)
      .eq('status', 'pending')
      .gt('expires_at', new Date().toISOString())
      .maybeSingle()
    if (!row) {
      return c.json(
        { ok: false, error: { code: 'NOT_FOUND', message: 'No pending authorization request — it may have expired. Retry the connection from your MCP client.' } },
        404,
      )
    }
    // The transaction is bound to the first authenticated viewer (see
    // GET /request). Only that user may approve it — a different signed-in user
    // must never be able to approve a consent flow they did not initiate.
    if (row.user_id && row.user_id !== userId) {
      return c.json(
        { ok: false, error: { code: 'NOT_FOUND', message: 'No pending authorization request — it may have expired. Retry the connection from your MCP client.' } },
        404,
      )
    }

    // Minting keys is owner/admin-only — same gate as POST /v1/admin/projects/:id/keys.
    const access = await userCanAccessProject(db, userId, projectId)
    if (!access.allowed) {
      return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Project not found' } }, 404)
    }
    if (access.role !== 'owner' && access.role !== 'admin') {
      return c.json({ ok: false, error: { code: 'FORBIDDEN', message: 'Owner or admin access required to connect an MCP client to this project' } }, 403)
    }

    const keyScopes = mapOAuthScopeToKeyScopes(row.scope)
    const rawKey = `mushi_${crypto.randomUUID().replace(/-/g, '')}`
    const prefix = rawKey.slice(0, 12)
    const keyHash = await sha256hex(rawKey)
    const keyId = crypto.randomUUID()
    const { error: keyErr } = await db.from('project_api_keys').insert({
      id: keyId,
      project_id: projectId,
      key_hash: keyHash,
      key_prefix: prefix,
      label: 'mcp-oauth',
      scopes: keyScopes,
      is_active: true,
    })
    if (keyErr) {
      return c.json({ ok: false, error: { code: 'DB_ERROR', message: keyErr.message } }, 500)
    }

    // Authorization code: 32 random bytes → 64-char hex; store only the hash.
    const codeBytes = new Uint8Array(32)
    crypto.getRandomValues(codeBytes)
    const code = Array.from(codeBytes).map((b) => b.toString(16).padStart(2, '0')).join('')
    const codeHash = await sha256hex(code)

    // `.eq('status','pending')` makes the UPDATE the lock — a concurrent
    // double-approve of the same transaction loses the race and 409s instead
    // of minting a second code for the same txn.
    const { data: updated, error: updateErr } = await db
      .from('mcp_oauth_requests')
      .update({
        status: 'approved',
        user_id: userId,
        project_id: projectId,
        api_key_id: keyId,
        code_hash: codeHash,
        access_token_raw: rawKey,
      })
      .eq('id', row.id)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle()
    if (updateErr || !updated) {
      // Roll the orphaned key back — nothing can ever exchange a code for it.
      await db.from('project_api_keys').delete().eq('id', keyId)
      return c.json({ ok: false, error: { code: 'CONFLICT', message: 'This request was already handled. Retry the connection from your MCP client.' } }, 409)
    }

    void logAudit(
      db,
      projectId,
      userId,
      'api_key.created',
      'project_api_key',
      keyId,
      { source: 'mcp_oauth_automint', scopes: keyScopes, key_prefix: prefix, oauth_txn: row.id },
      { actorType: 'console' },
    )
    try {
      log.info('mcp_oauth.approved', { actor_id: userId, txn: row.id, project_id: projectId, key_prefix: prefix })
    } catch { /* logging must never block approval */ }

    return c.json({
      ok: true,
      data: { redirect_to: appendRedirectParams(row.redirect_uri, { code, state: row.state }) },
    })
  })

  // ─── Deny ─────────────────────────────────────────────────────────────────
  // POST /v1/mcp-oauth/deny  (jwtAuth)  Body: { txn: uuid }
  app.post('/v1/mcp-oauth/deny', jwtAuth, async (c) => {
    const userId = c.get('userId') as string
    const body = (await c.req.json().catch(() => ({}))) as { txn?: string }
    const txn = typeof body.txn === 'string' ? body.txn.trim() : ''
    if (!UUID_RE.test(txn)) {
      return c.json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'txn must be a UUID' } }, 400)
    }
    const db = getServiceClient()
    // Only the console user the transaction is bound to (via GET /request) may
    // deny it. The `.eq('user_id', userId)` clause makes this the authorization
    // check: without it, any signed-in user could deny any pending transaction
    // by UUID and break other users' logins (DoS).
    const { data: row } = await db
      .from('mcp_oauth_requests')
      .update({ status: 'denied' })
      .eq('id', txn)
      .eq('status', 'pending')
      .eq('user_id', userId)
      .select('redirect_uri, state')
      .maybeSingle()
    if (!row) {
      return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'No pending request for that transaction' } }, 404)
    }
    return c.json({
      ok: true,
      data: {
        redirect_to: appendRedirectParams(row.redirect_uri, {
          error: 'access_denied',
          error_description: 'The user denied the request',
          state: row.state,
        }),
      },
    })
  })

  // ─── Token endpoint ───────────────────────────────────────────────────────
  // POST /v1/mcp-oauth/token  (public)
  // grant_type=authorization_code + code + code_verifier (+ client_id).
  // Returns the minted project API key as the access token. No refresh_token
  // and no expires_in: the key does not expire — it lives until revoked in
  // the console, which is the same lifecycle as every other project API key.
  app.post('/v1/mcp-oauth/token', async (c) => {
    const db = getServiceClient()
    const ip = extractClientIp(c)
    const rateMiss = await claimIpRateLimit(db, ip, 'mcp_oauth_token', 40, '1 minute')
    if (rateMiss) {
      c.header('Retry-After', String(rateMiss.retryAfterSeconds))
      return c.json(oauthError('temporarily_unavailable', 'Too many token requests — slow down.'), 429)
    }

    const params = await readOAuthParams(c.req.raw)
    const grantType = params.get('grant_type') ?? ''
    if (grantType !== 'authorization_code') {
      return c.json(oauthError('unsupported_grant_type', 'Only authorization_code is supported (tokens do not expire, so no refresh_token is issued)'), 400)
    }
    const code = (params.get('code') ?? '').trim()
    const codeVerifier = (params.get('code_verifier') ?? '').trim()
    const clientId = (params.get('client_id') ?? '').trim()
    const redirectUri = (params.get('redirect_uri') ?? '').trim()
    if (!code || !codeVerifier) {
      return c.json(oauthError('invalid_request', 'code and code_verifier are required'), 400)
    }

    const codeHash = await sha256hex(code)
    const { data: row } = await db
      .from('mcp_oauth_requests')
      .select('id, client_id, redirect_uri, scope, code_challenge, access_token_raw, token_claimed_at, expires_at, status')
      .eq('code_hash', codeHash)
      .eq('status', 'approved')
      .maybeSingle()
    if (!row) {
      return c.json(oauthError('invalid_grant', 'Unknown or already-used authorization code'), 400)
    }
    if (new Date(row.expires_at) < new Date()) {
      return c.json(oauthError('invalid_grant', 'The authorization code has expired — restart the connection from your MCP client'), 400)
    }
    // Public client binding: the token request must present the same
    // client_id the code was issued to (OAuth 2.1 §4.1.3), and the same
    // redirect_uri when one is echoed.
    if (!clientId || clientId.toLowerCase() !== String(row.client_id).toLowerCase()) {
      return c.json(oauthError('invalid_grant', 'client_id does not match the authorization request'), 400)
    }
    if (redirectUri && redirectUri !== row.redirect_uri) {
      return c.json(oauthError('invalid_grant', 'redirect_uri does not match the authorization request'), 400)
    }
    if (!(await verifyPkceS256(codeVerifier, row.code_challenge))) {
      return c.json(oauthError('invalid_grant', 'PKCE verification failed'), 400)
    }

    const delivery = evaluateTokenDelivery(
      { cli_token_raw: row.access_token_raw, cli_token_claimed_at: row.token_claimed_at },
      Date.now(),
    )
    if (delivery.action === 'invalid_grant') {
      if (delivery.reason === 'grace_elapsed' && row.access_token_raw) {
        await db.from('mcp_oauth_requests').update({ access_token_raw: null } as never).eq('id', row.id)
      }
      return c.json(oauthError('invalid_grant', 'The authorization code was already exchanged — restart the connection from your MCP client'), 400)
    }
    if (delivery.firstClaim) {
      const { error: claimError } = await db
        .from('mcp_oauth_requests')
        .update({ token_claimed_at: new Date().toISOString() } as never)
        .eq('id', row.id)
        .is('token_claimed_at', null)
      if (claimError) {
        return c.json(oauthError('server_error', 'Could not claim the token; please retry.'), 500)
      }
    }

    c.header('Cache-Control', 'no-store')
    c.header('Pragma', 'no-cache')
    return c.json({
      access_token: row.access_token_raw,
      token_type: 'Bearer',
      scope: grantedScopeString(mapOAuthScopeToKeyScopes(row.scope)),
    })
  })
}
