/**
 * Slack OAuth v2 install flow — exchanges a `code` for a workspace
 * bot token. Token rotation is ENABLED in manifest.json; callers should
 * persist `access_token`, `refresh_token`, `expires_at`, `bot_user_id`,
 * and `team.id` in `project_plugin_installations.credentials`.
 */

const AUTHORIZE_URL = 'https://slack.com/oauth/v2/authorize'
const TOKEN_URL = 'https://slack.com/api/oauth.v2.access'

export interface SlackOAuthConfig {
  clientId: string
  clientSecret: string
  redirectUri: string
  scopes?: string[]
}

export interface SlackTokens {
  botToken: string
  refreshToken?: string
  expiresAt?: number
  botUserId: string
  teamId: string
  teamName: string
}

export function buildInstallUrl(config: SlackOAuthConfig, state: string): string {
  const scopes = (config.scopes ?? ['chat:write', 'commands', 'users:read', 'users:read.email']).join(',')
  const params = new URLSearchParams({
    client_id: config.clientId,
    scope: scopes,
    redirect_uri: config.redirectUri,
    state,
  })
  return `${AUTHORIZE_URL}?${params}`
}

export async function exchangeCode(config: SlackOAuthConfig, code: string): Promise<SlackTokens> {
  const form = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code,
    redirect_uri: config.redirectUri,
  })
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form,
  })
  if (!res.ok) throw new Error(`Slack oauth.v2.access HTTP ${res.status}`)
  const data = await res.json() as {
    ok: boolean
    error?: string
    access_token: string
    refresh_token?: string
    expires_in?: number
    bot_user_id: string
    team: { id: string; name: string }
  }
  if (!data.ok) throw new Error(`Slack OAuth failed: ${data.error}`)
  return {
    botToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
    botUserId: data.bot_user_id,
    teamId: data.team.id,
    teamName: data.team.name,
  }
}
