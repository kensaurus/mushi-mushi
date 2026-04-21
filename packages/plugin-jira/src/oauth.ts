/**
 * Wave G3 — Atlassian OAuth 2.0 (3LO) connect flow.
 *
 * Atlassian requires PKCE + `offline_access` for refresh tokens, a rotated
 * `cloudid` for every API call, and a 60-minute access-token lifetime. We
 * persist `access_token`, `refresh_token`, `cloud_id`, `expires_at` in
 * `project_plugin_installations.credentials` (encrypted by pgsodium at
 * rest) and auto-refresh 2 minutes before expiry.
 *
 * This module is pure — no HTTP framework coupling. Host it behind any
 * Express/Hono/Next route handler.
 */

import { randomBytes, createHash } from 'node:crypto'

const AUTHORIZE_URL = 'https://auth.atlassian.com/authorize'
const TOKEN_URL = 'https://auth.atlassian.com/oauth/token'
const ACCESSIBLE_RESOURCES_URL = 'https://api.atlassian.com/oauth/token/accessible-resources'

export interface OAuthConfig {
  clientId: string
  clientSecret: string
  redirectUri: string
  scopes?: string[]
}

export interface AuthorizeUrlResult {
  url: string
  state: string
  codeVerifier: string
}

export interface JiraTokens {
  accessToken: string
  refreshToken: string
  expiresAt: number
  cloudId: string
  cloudUrl: string
}

export function buildAuthorizeUrl(config: OAuthConfig, projectId: string): AuthorizeUrlResult {
  const codeVerifier = base64url(randomBytes(32))
  const codeChallenge = base64url(createHash('sha256').update(codeVerifier).digest())
  const state = `${projectId}.${base64url(randomBytes(16))}`
  const scopes = (config.scopes ?? ['read:jira-work', 'write:jira-work', 'offline_access']).join(' ')
  const params = new URLSearchParams({
    audience: 'api.atlassian.com',
    client_id: config.clientId,
    scope: scopes,
    redirect_uri: config.redirectUri,
    state,
    response_type: 'code',
    prompt: 'consent',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  })
  return { url: `${AUTHORIZE_URL}?${params}`, state, codeVerifier }
}

export async function exchangeCode(config: OAuthConfig, code: string, codeVerifier: string): Promise<JiraTokens> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      redirect_uri: config.redirectUri,
      code_verifier: codeVerifier,
    }),
  })
  if (!res.ok) throw new Error(`Atlassian token exchange failed: HTTP ${res.status} ${await res.text()}`)
  const data = await res.json() as { access_token: string; refresh_token: string; expires_in: number }

  const resourcesRes = await fetch(ACCESSIBLE_RESOURCES_URL, {
    headers: { Authorization: `Bearer ${data.access_token}` },
  })
  if (!resourcesRes.ok) throw new Error(`Atlassian accessible-resources lookup failed: HTTP ${resourcesRes.status}`)
  const resources = await resourcesRes.json() as Array<{ id: string; url: string }>
  const primary = resources[0]
  if (!primary) throw new Error('Atlassian returned zero accessible resources — user declined consent?')

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
    cloudId: primary.id,
    cloudUrl: primary.url,
  }
}

export async function refreshTokens(config: OAuthConfig, refreshToken: string): Promise<JiraTokens> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: refreshToken,
    }),
  })
  if (!res.ok) throw new Error(`Atlassian token refresh failed: HTTP ${res.status} ${await res.text()}`)
  const data = await res.json() as { access_token: string; refresh_token: string; expires_in: number }
  // Caller is expected to merge the refreshed fields onto the existing
  // row so `cloudId` + `cloudUrl` survive — they don't change on refresh.
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
    cloudId: '',
    cloudUrl: '',
  }
}

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
