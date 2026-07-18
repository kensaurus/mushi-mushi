// SPDX-License-Identifier: MIT
// Copyright (c) 2024–2026 Kenji Sakuramoto (kensaurus) — Mushi Mushi
/**
 * Linear integration helpers for @mushi-mushi/node.
 *
 * Provides programmatic connection management for server-side automation,
 * CI pipelines, and scripts. These call the Mushi REST API — the vaulted
 * credentials are stored server-side and never leave Mushi.
 *
 * OAuth connect is intentionally browser-only (it requires a redirect).
 * For scripted or CI environments, use `connectLinearApiKey` to configure
 * a personal API key programmatically.
 *
 * @example
 * ```ts
 * import { connectLinearApiKey } from '@mushi-mushi/node/linear'
 *
 * await connectLinearApiKey(
 *   { apiKey: process.env.MUSHI_API_KEY!, projectId: 'proj_123' },
 *   process.env.LINEAR_API_KEY!,
 *   process.env.LINEAR_TEAM_ID,
 * )
 * ```
 */

import { DEFAULT_API_ENDPOINT } from '@mushi-mushi/core'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface LinearConnectorOptions {
  /** Mushi project API key (must have write scope). */
  apiKey: string
  /** Mushi project ID to configure. */
  projectId: string
  /** Override the Mushi API base URL (default: Mushi cloud). */
  baseUrl?: string
}

export interface LinearConnectionStatus {
  connected: boolean
  /** Workspace name from Linear OAuth install, if connected via OAuth. */
  workspaceName: string | null
  /** Default Linear team ID configured for this project. */
  teamId: string | null
  /** Whether the connection is via OAuth (full feature set) or API key (limited). */
  authMethod: 'oauth' | 'api_key' | null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildHeaders(apiKey: string) {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  }
}

function resolveEndpoint(opts: LinearConnectorOptions) {
  return (opts.baseUrl ?? DEFAULT_API_ENDPOINT).replace(/\/$/, '')
}

async function mushiPut(
  opts: LinearConnectorOptions,
  path: string,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`${resolveEndpoint(opts)}${path}`, {
    method: 'PUT',
    headers: {
      ...buildHeaders(opts.apiKey),
      'X-Mushi-Project-Id': opts.projectId,
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    let msg = `HTTP ${res.status}`
    try {
      const json = await res.json() as { error?: { message?: string } }
      msg = json.error?.message ?? msg
    } catch {
      // ignore
    }
    return { ok: false, error: msg }
  }
  return { ok: true }
}

async function mushiGet<T>(
  opts: LinearConnectorOptions,
  path: string,
): Promise<{ ok: boolean; data?: T; error?: string }> {
  const res = await fetch(`${resolveEndpoint(opts)}${path}`, {
    method: 'GET',
    headers: {
      ...buildHeaders(opts.apiKey),
      'X-Mushi-Project-Id': opts.projectId,
    },
  })
  if (!res.ok) {
    let msg = `HTTP ${res.status}`
    try {
      const json = await res.json() as { error?: { message?: string } }
      msg = json.error?.message ?? msg
    } catch {
      // ignore
    }
    return { ok: false, error: msg }
  }
  const json = await res.json() as T
  return { ok: true, data: json }
}

async function mushiDelete(
  opts: LinearConnectorOptions,
  path: string,
): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`${resolveEndpoint(opts)}${path}`, {
    method: 'DELETE',
    headers: {
      ...buildHeaders(opts.apiKey),
      'X-Mushi-Project-Id': opts.projectId,
    },
  })
  if (!res.ok) {
    let msg = `HTTP ${res.status}`
    try {
      const json = await res.json() as { error?: { message?: string } }
      msg = json.error?.message ?? msg
    } catch {
      // ignore
    }
    return { ok: false, error: msg }
  }
  return { ok: true }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Configure a Linear static API key for the project.
 *
 * Use this for CI pipelines or self-hosted environments where browser OAuth is
 * not practical. For full feature support (two-way sync, agent mode), connect
 * via OAuth in the Mushi admin console instead.
 *
 * @param opts    - Mushi connector options (Mushi API key + project ID)
 * @param linearApiKey - Linear personal API key (lin_api_…). The key is vaulted
 *                       server-side; it never appears in plaintext after this call.
 * @param teamId  - Optional Linear team identifier (e.g. "ENG") used when
 *                  creating issues. Falls back to the first team in your workspace.
 *
 * @throws if the API call fails (network error or non-2xx response).
 */
export async function connectLinearApiKey(
  opts: LinearConnectorOptions,
  linearApiKey: string,
  teamId?: string,
): Promise<void> {
  const body: Record<string, unknown> = { linear_api_key_ref: linearApiKey }
  if (teamId) body.linear_team_id = teamId

  const res = await mushiPut(opts, '/v1/admin/integrations/platform/linear', body)
  if (!res.ok) {
    throw new Error(`connectLinearApiKey failed: ${res.error}`)
  }
}

/**
 * Get the current Linear connection status for the project.
 *
 * Returns whether Linear is configured, the workspace name (if connected via
 * OAuth), the default team ID, and the authentication method.
 */
export async function getLinearConnectionStatus(
  opts: LinearConnectorOptions,
): Promise<LinearConnectionStatus> {
  // The server wraps the response in { ok, data: { platform, sourceByField } }.
  // mushiGet<T> returns the raw JSON body as `res.data`, so the Linear entry
  // lives at res.data.data.platform.linear (outer `data` = envelope, inner
  // `data` = payload).
  type PlatformResp = {
    ok: boolean
    data: {
      platform?: Record<string, Record<string, unknown> | null>
      sourceByField?: Record<string, string>
    } | null
  }

  const res = await mushiGet<PlatformResp>(opts, '/v1/admin/integrations/platform')
  if (!res.ok || !res.data) {
    throw new Error(`getLinearConnectionStatus failed: ${res.error ?? 'no data'}`)
  }

  const lp = res.data.data?.platform?.['linear'] as {
    linear_workspace_name?: string | null
    linear_team_id?: string | null
    linear_access_token_ref?: string | null
    linear_api_key_ref?: string | null
  } | null | undefined
  const oauthConnected = Boolean(lp?.linear_access_token_ref)
  const apiKeyConnected = Boolean(lp?.linear_api_key_ref)

  return {
    connected: oauthConnected || apiKeyConnected,
    workspaceName: lp?.linear_workspace_name ?? null,
    teamId: lp?.linear_team_id ?? null,
    authMethod: oauthConnected ? 'oauth' : apiKeyConnected ? 'api_key' : null,
  }
}

/**
 * Disconnect Linear from the project. Clears all vault-backed credentials
 * (OAuth access token, refresh token, API key, webhook secret, actor token).
 *
 * @throws if the API call fails.
 */
export async function disconnectLinear(opts: LinearConnectorOptions): Promise<void> {
  const res = await mushiDelete(opts, '/v1/admin/linear-oauth/disconnect')
  if (!res.ok) {
    throw new Error(`disconnectLinear failed: ${res.error}`)
  }
}
