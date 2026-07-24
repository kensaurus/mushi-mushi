// SPDX-License-Identifier: MIT
// Copyright (c) 2024–2026 Kenji Sakuramoto (kensaurus) — Mushi Mushi
/**
 * Shared Linear API helpers.
 *
 * - Resolves credentials from vault-backed project_settings (OAuth access token
 *   preferred over static API key).
 * - Handles OAuth token refresh when the access token has expired.
 * - Provides a thin linearGql() wrapper for typed GraphQL calls.
 * - Used by: _shared/integrations.ts, fix-worker, classify-report, mcp/index.ts,
 *            webhooks-linear/, webhooks-linear-agent/, linear-oauth-callback/.
 */

import { fetchWithTimeout } from './http.ts'
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { log as rootLog } from './logger.ts'
import { dereferenceMaybeVault } from './integration-probes.ts'

const log = rootLog.child('linear')

const LINEAR_GRAPHQL = 'https://api.linear.app/graphql'
const LINEAR_TOKEN_ENDPOINT = 'https://api.linear.app/oauth/token'

// ── Token resolution ─────────────────────────────────────────────────────────

/**
 * Resolves the best available Linear auth token for a project:
 *   1. OAuth access token (linear_access_token_ref, vault-backed)
 *   2. Static Personal API key (linear_api_key_ref, vault-backed)
 *   3. Server env var LINEAR_API_KEY (self-hosted fallback)
 *
 * Automatically refreshes the OAuth access token when it has expired (identified
 * by a 401 response from Linear's API) using the stored refresh token.
 *
 * Returns null if no credential is configured for the project.
 */
export async function getLinearToken(
  db: SupabaseClient,
  projectId: string,
): Promise<string | null> {
  const { data: ps } = await db
    .from('project_settings')
    .select(
      'linear_access_token_ref, linear_api_key_ref',
    )
    .eq('project_id', projectId)
    .maybeSingle()

  if (!ps) {
    return Deno.env.get('LINEAR_API_KEY') ?? null
  }

  // OAuth access token (preferred)
  if (ps.linear_access_token_ref) {
    const token = await dereferenceMaybeVault(db, ps.linear_access_token_ref)
    if (token) return token
  }

  // Static API key
  if (ps.linear_api_key_ref) {
    const key = await dereferenceMaybeVault(db, ps.linear_api_key_ref)
    if (key) return key
  }

  return Deno.env.get('LINEAR_API_KEY') ?? null
}

/**
 * Refreshes an expired OAuth access token using the project's stored refresh
 * token. Updates vault refs in project_settings. Returns the new access token,
 * or throws if the refresh fails.
 *
 * Only called by linearGql() on receipt of a 401 — callers don't need to invoke
 * this directly.
 */
export async function refreshLinearToken(
  db: SupabaseClient,
  projectId: string,
): Promise<string> {
  const clientId = Deno.env.get('LINEAR_OAUTH_CLIENT_ID')
  const clientSecret = Deno.env.get('LINEAR_OAUTH_CLIENT_SECRET')
  if (!clientId || !clientSecret) {
    throw new Error('LINEAR_OAUTH_CLIENT_ID / LINEAR_OAUTH_CLIENT_SECRET env vars not set')
  }

  const { data: ps } = await db
    .from('project_settings')
    .select('linear_refresh_token_ref')
    .eq('project_id', projectId)
    .maybeSingle()

  const refreshToken = ps?.linear_refresh_token_ref
    ? await dereferenceMaybeVault(db, ps.linear_refresh_token_ref)
    : null

  if (!refreshToken) {
    throw new Error(`No Linear refresh token for project ${projectId}`)
  }

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  })

  const res = await fetchWithTimeout(LINEAR_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Linear token refresh HTTP ${res.status}: ${text.slice(0, 300)}`)
  }

  const json = await res.json() as {
    access_token: string
    refresh_token?: string
    expires_in?: number
  }

  if (!json.access_token) {
    throw new Error('Linear token refresh returned no access_token')
  }

  // Vault and persist the new tokens using the standard vault_store_secret(name, value) RPC.
  // The ref stored in project_settings is vault://<secretName> (looked up by name, not UUID).
  const { access_token: newAccess, refresh_token: newRefresh } = json
  const accessName = `project:${projectId}:linear_access_token`
  const refreshName = `project:${projectId}:linear_refresh_token`

  await db.rpc('vault_store_secret', {
    secret_name: accessName,
    secret_value: newAccess,
  })
  if (newRefresh) {
    await db.rpc('vault_store_secret', {
      secret_name: refreshName,
      secret_value: newRefresh,
    })
  }

  log.info('Refreshed Linear access token', { projectId })
  return newAccess
}

// ── GraphQL caller ───────────────────────────────────────────────────────────

/**
 * Makes an authenticated GraphQL request to the Linear API on behalf of a project.
 *
 * On HTTP 401 the function will attempt to refresh the OAuth token once and retry.
 * Throws on GraphQL-level errors or network failures.
 */
export async function linearGql<T>(
  db: SupabaseClient,
  projectId: string,
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  // Use getLinearAuthHeader so OAuth tokens get the required `Bearer` prefix
  // while personal API keys are sent as a raw value (per Linear API docs).
  const authHeader = await getLinearAuthHeader(db, projectId)
  if (!authHeader) throw new Error(`No Linear credentials configured for project ${projectId}`)

  const doRequest = async (auth: string): Promise<T> => {
    const res = await fetchWithTimeout(LINEAR_GRAPHQL, {
      method: 'POST',
      headers: {
        Authorization: auth,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, variables }),
    })

    if (res.status === 401) {
      throw Object.assign(new Error('Linear API 401'), { status: 401 })
    }
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Linear API HTTP ${res.status}: ${text.slice(0, 300)}`)
    }

    const json = await res.json() as { data?: T; errors?: Array<{ message: string }> }
    if (json.errors?.length) {
      throw new Error(`Linear GraphQL error: ${json.errors.map((e) => e.message).join('; ')}`)
    }
    if (!json.data) throw new Error('Linear GraphQL: no data in response')
    return json.data
  }

  try {
    return await doRequest(authHeader)
  } catch (err) {
    // On 401 from an OAuth token, try refreshing once.
    // The refreshed token is always an OAuth access token → always needs Bearer.
    if ((err as { status?: number }).status === 401) {
      const { data: ps } = await db
        .from('project_settings')
        .select('linear_access_token_ref')
        .eq('project_id', projectId)
        .maybeSingle()

      if (ps?.linear_access_token_ref) {
        log.warn('Linear 401 — attempting token refresh', { projectId })
        const newToken = await refreshLinearToken(db, projectId)
        return await doRequest(`Bearer ${newToken}`) // OAuth token — always Bearer
      }
    }
    throw err
  }
}

// ── Convenience helpers ──────────────────────────────────────────────────────

/**
 * Returns the correct `Authorization` header value for the best available
 * Linear credential:
 *   - OAuth access token → `Bearer <token>` (per Linear API docs)
 *   - Personal API key  → raw key, no prefix (per Linear API docs)
 *   - Env var fallback  → raw key, no prefix
 *
 * Use this instead of `getLinearToken` when making HTTP requests to Linear.
 */
export async function getLinearAuthHeader(
  db: SupabaseClient,
  projectId: string,
): Promise<string | null> {
  const { data: ps } = await db
    .from('project_settings')
    .select('linear_access_token_ref, linear_api_key_ref')
    .eq('project_id', projectId)
    .maybeSingle()

  if (ps?.linear_access_token_ref) {
    const token = await dereferenceMaybeVault(db, ps.linear_access_token_ref)
    if (token) return `Bearer ${token}` // OAuth access token requires Bearer prefix
  }
  if (ps?.linear_api_key_ref) {
    const key = await dereferenceMaybeVault(db, ps.linear_api_key_ref)
    if (key) return key // Personal API key: raw value, no Bearer per Linear docs
  }
  const envKey = Deno.env.get('LINEAR_API_KEY')
  return envKey ?? null // env fallback: also a personal API key (no Bearer)
}

/** Returns true when the project has any Linear credential configured. */
export async function isLinearConnected(
  db: SupabaseClient,
  projectId: string,
): Promise<boolean> {
  const token = await getLinearToken(db, projectId)
  return token !== null
}

/**
 * Fetches the Linear workspace name for a project — used in console UI
 * health displays without triggering a full probe.
 */
export async function getLinearWorkspaceName(
  db: SupabaseClient,
  projectId: string,
): Promise<string | null> {
  // First check the cached workspace name stored during OAuth
  const { data: ps } = await db
    .from('project_settings')
    .select('linear_workspace_name')
    .eq('project_id', projectId)
    .maybeSingle()

  if (ps?.linear_workspace_name) return ps.linear_workspace_name

  // Fall back to a live API call
  try {
    const data = await linearGql<{ viewer: { organization: { name: string } } }>(
      db,
      projectId,
      `query { viewer { organization { name } } }`,
    )
    return data.viewer?.organization?.name ?? null
  } catch {
    return null
  }
}
