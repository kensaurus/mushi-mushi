// SPDX-License-Identifier: MIT
// Copyright (c) 2024–2026 Kenji Sakuramoto (kensaurus) — Mushi Mushi
/**
 * linear-oauth-callback — Supabase Edge Function
 *
 * Completes the OAuth 2.0 Authorization Code flow for Linear. Called by
 * Linear after the user approves the Mushi OAuth application.
 *
 * Flow:
 *   1. Validate the `state` nonce (anti-CSRF, stored in linear_oauth_states).
 *   2. Exchange `code` for access + refresh tokens at Linear's token endpoint.
 *   3. Fetch the workspace name for display.
 *   4. Vault both tokens and upsert project_settings columns.
 *   5. Register an inbound webhook on Linear so issue updates flow back to Mushi.
 *   6. Redirect to the admin console Integrations page with ?connected=linear.
 *
 * Required env vars (Supabase project secrets):
 *   LINEAR_OAUTH_CLIENT_ID       — Linear OAuth app client ID
 *   LINEAR_OAUTH_CLIENT_SECRET   — Linear OAuth app client secret
 *   ADMIN_ORIGIN                 — Base URL of admin console (e.g. https://app.mushi.com)
 *   SUPABASE_URL                 — injected by runtime
 *   SUPABASE_SERVICE_ROLE_KEY    — injected by runtime
 */

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { log as rootLog } from '../_shared/logger.ts'

const log = rootLog.child('linear-oauth-callback')

const LINEAR_TOKEN_ENDPOINT = 'https://api.linear.app/oauth/token'
const LINEAR_GRAPHQL = 'https://api.linear.app/graphql'
const LINEAR_WEBHOOK_RESOURCE_TYPES = ['Issue']

Deno.serve(async (req: Request) => {
  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const errorParam = url.searchParams.get('error')

  const adminOrigin = Deno.env.get('ADMIN_ORIGIN') ?? ''
  const errorRedirect = (msg: string) =>
    Response.redirect(`${adminOrigin}/integrations?linear_error=${encodeURIComponent(msg)}`, 302)

  // ── Validate request ───────────────────────────────────────────────────────

  if (errorParam) {
    log.warn('Linear OAuth denied by user', { error: errorParam })
    return errorRedirect(`Linear authorization denied: ${errorParam}`)
  }
  if (!code || !state) {
    return errorRedirect('Missing code or state parameter')
  }

  const clientId = Deno.env.get('LINEAR_OAUTH_CLIENT_ID')
  const clientSecret = Deno.env.get('LINEAR_OAUTH_CLIENT_SECRET')
  if (!clientId || !clientSecret) {
    log.error('LINEAR_OAUTH_CLIENT_ID or LINEAR_OAUTH_CLIENT_SECRET not configured')
    return errorRedirect('Server misconfiguration: OAuth credentials missing')
  }

  // ── Create service-role client ─────────────────────────────────────────────

  const db = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { persistSession: false } },
  )

  // ── Validate & consume the state nonce ────────────────────────────────────

  // Atomic consume: delete the row by nonce and return it in a single
  // round-trip. Two concurrent requests with the same state value race to
  // delete the same nonce — the first wins, the second gets null (already
  // deleted). This is TOCTOU-safe: the non-atomic read→delete pattern would
  // let two concurrent callbacks both pass the read before either delete lands.
  const { data: stateRow, error: stateErr } = await db
    .from('linear_oauth_states')
    .delete()
    .eq('nonce', state)
    .select('id, project_id, created_at')
    .maybeSingle()

  if (stateErr || !stateRow) {
    log.warn('Invalid or already-consumed OAuth state', { state, error: String(stateErr) })
    return errorRedirect('Invalid or expired authorization state. Please try again.')
  }

  // Enforce 10-minute TTL on the now-consumed nonce
  const ageMs = Date.now() - new Date(stateRow.created_at as string).getTime()
  if (ageMs > 10 * 60 * 1000) {
    return errorRedirect('Authorization state expired. Please try again.')
  }

  const projectId = stateRow.project_id as string

  // ── Exchange code for tokens ───────────────────────────────────────────────

  const callbackUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/linear-oauth-callback`
  const tokenBody = new URLSearchParams({
    code,
    grant_type: 'authorization_code',
    redirect_uri: callbackUrl,
    client_id: clientId,
    client_secret: clientSecret,
  })

  const tokenRes = await fetch(LINEAR_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: tokenBody.toString(),
  })

  if (!tokenRes.ok) {
    const body = await tokenRes.text()
    log.error('Linear token exchange failed', { status: tokenRes.status, body: body.slice(0, 300) })
    return errorRedirect(`Token exchange failed (HTTP ${tokenRes.status})`)
  }

  const tokenData = await tokenRes.json() as {
    access_token: string
    refresh_token?: string
    expires_in?: number
    token_type: string
    scope: string
  }

  if (!tokenData.access_token) {
    return errorRedirect('No access token returned from Linear')
  }

  // ── Fetch workspace info ───────────────────────────────────────────────────

  type ViewerData = { viewer: { id: string; name: string; organization: { id: string; name: string; urlKey: string } } }
  let workspaceName: string | null = null
  let linearOrgId: string | null = null

  try {
    const gqlRes = await fetch(LINEAR_GRAPHQL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: `{ viewer { id name organization { id name urlKey } } }` }),
    })
    if (gqlRes.ok) {
      const gqlData = await gqlRes.json() as { data?: ViewerData }
      workspaceName = gqlData.data?.viewer?.organization?.name ?? null
      linearOrgId = gqlData.data?.viewer?.organization?.id ?? null
    }
  } catch (err) {
    log.warn('Could not fetch Linear workspace name', { err: String(err) })
  }

  // ── Vault the tokens ──────────────────────────────────────────────────────

  const vaultName = (field: string) => `project:${projectId}:${field}`

  // deno-lint-ignore no-explicit-any
  const dbAny = db as any
  /**
   * Vaults a secret using the existing vault_store_secret(secret_name, secret_value) RPC
   * (defined in migration 20260418001600_byok_key_source.sql).
   * Returns `vault://<secretName>` — dereferenceMaybeVault resolves by name via vault_lookup.
   */
  const vaultAndStore = async (secret: string, field: string): Promise<string> => {
    const name = vaultName(field)
    const { error } = await dbAny.rpc('vault_store_secret', { secret_name: name, secret_value: secret })
    if (error) throw new Error(`vault_store_secret failed for ${field}: ${(error as { message: string }).message}`)
    return `vault://${name}`
  }

  let accessTokenRef: string
  let refreshTokenRef: string | null = null

  try {
    accessTokenRef = await vaultAndStore(tokenData.access_token, 'linear_access_token')
    if (tokenData.refresh_token) {
      refreshTokenRef = await vaultAndStore(tokenData.refresh_token, 'linear_refresh_token')
    }
  } catch (err) {
    log.error('Failed to vault Linear tokens', { err: String(err), projectId })
    return errorRedirect('Failed to securely store tokens. Please contact support.')
  }

  // ── Fetch the team ID if not already set ──────────────────────────────────

  type TeamsData = { teams: { nodes: Array<{ id: string; name: string }> } }
  let defaultTeamId: string | null = null

  try {
    const teamsRes = await fetch(LINEAR_GRAPHQL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: `{ teams(first: 1) { nodes { id name } } }` }),
    })
    if (teamsRes.ok) {
      const teamsData = await teamsRes.json() as { data?: TeamsData }
      defaultTeamId = teamsData.data?.teams?.nodes?.[0]?.id ?? null
    }
  } catch {
    // Non-fatal — user can pick team in console
  }

  // ── Upsert project_settings ────────────────────────────────────────────────

  const updates: Record<string, string | null> = {
    linear_access_token_ref: accessTokenRef,
    linear_workspace_name: workspaceName,
  }
  if (refreshTokenRef) updates.linear_refresh_token_ref = refreshTokenRef
  if (defaultTeamId) updates.linear_team_id = defaultTeamId

  const { error: upsertError } = await db
    .from('project_settings')
    .update(updates)
    .eq('project_id', projectId)

  if (upsertError) {
    log.error('Failed to save Linear settings', { err: upsertError.message, projectId })
    return errorRedirect('Failed to save integration settings.')
  }

  // ── Register inbound webhook on Linear ───────────────────────────────────

  if (defaultTeamId) {
    await registerLinearWebhook(
      db,
      projectId,
      tokenData.access_token,
      defaultTeamId,
    )
  }

  log.info('Linear OAuth connected', {
    projectId,
    workspace: workspaceName,
    scopes: tokenData.scope,
  })

  return Response.redirect(`${adminOrigin}/integrations?connected=linear`, 302)
})

// ── Webhook registration helper ───────────────────────────────────────────────

async function registerLinearWebhook(
  // deno-lint-ignore no-explicit-any
  db: SupabaseClient<any, any, any>,
  projectId: string,
  accessToken: string,
  teamId: string,
): Promise<void> {
  const webhookUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/webhooks-linear`

  const MUTATION = `
    mutation WebhookCreate($input: WebhookCreateInput!) {
      webhookCreate(input: $input) {
        success
        webhook { id secret }
      }
    }
  `
  const variables = {
    input: {
      url: webhookUrl,
      teamId,
      resourceTypes: LINEAR_WEBHOOK_RESOURCE_TYPES,
      label: 'Mushi webhook',
    },
  }

  try {
    const res = await fetch('https://api.linear.app/graphql', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: MUTATION, variables }),
    })

    if (!res.ok) {
      log.warn('Linear webhookCreate HTTP error', { status: res.status, projectId })
      return
    }

    const data = await res.json() as {
      data?: { webhookCreate?: { success: boolean; webhook?: { id: string; secret: string } } }
      errors?: Array<{ message: string }>
    }

    const webhook = data.data?.webhookCreate?.webhook
    if (!webhook?.secret) {
      log.warn('Linear webhookCreate returned no secret', {
        errors: data.errors,
        projectId,
      })
      return
    }

    // Vault the webhook signing secret using the standard vault_store_secret(name, value) RPC.
    // deno-lint-ignore no-explicit-any
    const dbA = db as any
    const secretName = `project:${projectId}:linear_webhook_secret`
    const { error } = await dbA.rpc('vault_store_secret', {
      secret_name: secretName,
      secret_value: webhook.secret,
    })
    if (error) {
      log.error('Failed to vault Linear webhook secret', { err: error.message, projectId })
      return
    }

    await dbA
      .from('project_settings')
      .update({ linear_webhook_secret_ref: `vault://${secretName}` })
      .eq('project_id', projectId)

    log.info('Linear webhook registered', { projectId, webhookId: webhook.id })
  } catch (err) {
    // Non-fatal — webhook can be registered manually or retried
    log.error('Linear webhook registration threw', { err: String(err), projectId })
  }
}
