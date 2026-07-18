/**
 * _shared/integration-probes.ts
 *
 * Canonical per-integration probe logic. Used by two callers:
 *   1. POST /v1/admin/health/integration/:kind  — manual trigger from the UI
 *   2. integration-health-probe edge function   — 15-min pg_cron sweep
 *
 * Each probe does the smallest authenticated request against the provider
 * (cheapest possible model call, HEAD-equivalent, or no-op event) and returns
 * a structured { status, detail, httpStatus, latencyMs }.
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

import { HEALTH_PROBE_ANTHROPIC_MODEL, HEALTH_PROBE_OPENAI_MODEL } from './models.ts'

// Deno global — declared only where consumed (edge functions).
declare const Deno: { env: { get(name: string): string | undefined } }

// ──────────────────────────────────────────────────────────────────────────
// Public types
// ──────────────────────────────────────────────────────────────────────────

export type IntegrationKind =
  | 'sentry'
  | 'langfuse'
  | 'github'
  | 'anthropic'
  | 'openai'
  | 'jira'
  | 'linear'
  | 'github_issues'
  | 'pagerduty'
  | 'reward_webhook'
  | 'claude_code_agent'
  | 'cursor_cloud'
  | 'slack'

export const PLATFORM_KINDS: IntegrationKind[] = ['sentry', 'langfuse', 'github', 'anthropic', 'openai']
/** Fix-agent integrations stored in project_settings (Integrations → Cursor Cloud / Claude Code). */
export const FIX_AGENT_KINDS: IntegrationKind[] = ['cursor_cloud', 'claude_code_agent']
/** Ticket/project-management integrations with vault-backed credentials in project_settings. */
export const TICKET_INTEGRATION_KINDS: IntegrationKind[] = ['linear']
export const ROUTING_KINDS: IntegrationKind[] = ['jira', 'github_issues', 'pagerduty', 'reward_webhook']
export const ALL_INTEGRATION_KINDS: IntegrationKind[] = [
  ...PLATFORM_KINDS,
  ...FIX_AGENT_KINDS,
  ...ROUTING_KINDS,
]

export interface ProbeResult {
  status: 'ok' | 'degraded' | 'down' | 'unknown'
  detail: string
  httpStatus: number
  latencyMs: number
}

/** Subset of project_settings used for platform probes. */
export interface PlatformSettings {
  sentry_org_slug?: string | null
  sentry_auth_token_ref?: string | null
  langfuse_host?: string | null
  langfuse_public_key_ref?: string | null
  langfuse_secret_key_ref?: string | null
  github_repo_url?: string | null
  github_installation_token_ref?: string | null
  cursor_api_key_ref?: string | null
  cursor_default_model?: string | null
  claude_api_key_ref?: string | null
  /** UUID of vault secret containing the per-project Slack bot token (xoxb-*). */
  slack_bot_token_ref?: string | null
  // ── Linear (vault-backed, replaces project_integrations.config for 'linear') ──
  /** Vault ref for a static Linear Personal API key (lin_api_*). */
  linear_api_key_ref?: string | null
  /** Vault ref for a Linear OAuth 2.0 access token. Takes precedence over api key. */
  linear_access_token_ref?: string | null
  /** Vault ref for the Linear OAuth 2.0 refresh token. */
  linear_refresh_token_ref?: string | null
  /** Display name of the connected Linear workspace (non-secret). */
  linear_workspace_name?: string | null
  /** Linear team UUID for default issue creation. */
  linear_team_id?: string | null
  /** Vault ref for the HMAC secret returned by Linear's webhookCreate (for inbound webhooks). */
  linear_webhook_secret_ref?: string | null
  /** Vault ref for the app actor token minted via actor=app OAuth install (agent mode). */
  linear_actor_token_ref?: string | null
}

// ──────────────────────────────────────────────────────────────────────────
// Vault helper
// ──────────────────────────────────────────────────────────────────────────

/**
 * Resolve a `vault://<uuid>` reference to its plaintext secret.
 * Non-vault strings are returned as-is (raw values stored in settings).
 * Returns null if the vault lookup fails or the ref is empty.
 */
export async function dereferenceMaybeVault(
  db: SupabaseClient,
  ref: string | null,
): Promise<string | null> {
  if (!ref) return null
  if (!ref.startsWith('vault://')) return ref
  const id = ref.slice('vault://'.length)
  const { data, error } = await db.rpc('vault_get_secret', { secret_id: id })
  if (error) return null
  return typeof data === 'string' ? data : null
}

// ──────────────────────────────────────────────────────────────────────────
// Main probe dispatcher
// ──────────────────────────────────────────────────────────────────────────

/**
 * Probe one integration. Returns the probe result including timing.
 *
 * @param kind            - One of the IntegrationKind values.
 * @param db              - Supabase service-role client (for vault deref).
 * @param settings        - Row from project_settings (platform integrations).
 * @param routingConfig   - Row from project_integrations.config (routing providers).
 */
export async function probeIntegration(
  kind: IntegrationKind,
  db: SupabaseClient,
  settings: PlatformSettings,
  routingConfig: Record<string, unknown> = {},
  projectId?: string,
): Promise<ProbeResult> {
  const start = Date.now()
  let status: ProbeResult['status'] = 'unknown'
  let detail = ''
  let httpStatus = 0

  try {
    if (kind === 'sentry') {
      const token = await dereferenceMaybeVault(db, settings.sentry_auth_token_ref ?? null)
      const org = settings.sentry_org_slug
      if (!token || !org) {
        detail = 'Set sentry_org_slug and sentry_auth_token in Integrations to enable health checks.'
      } else {
        const res = await fetch(
          `https://sentry.io/api/0/organizations/${encodeURIComponent(org)}/`,
          { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8_000) },
        )
        httpStatus = res.status
        status = res.ok
          ? 'ok'
          : res.status === 401 || res.status === 403
            ? 'down'
            : 'degraded'
        if (!res.ok) detail = `HTTP ${res.status}`
      }

    } else if (kind === 'langfuse') {
      const host = settings.langfuse_host || Deno.env.get('LANGFUSE_BASE_URL') || 'https://cloud.langfuse.com'
      const pub =
        (await dereferenceMaybeVault(db, settings.langfuse_public_key_ref ?? null)) ||
        Deno.env.get('LANGFUSE_PUBLIC_KEY') ||
        ''
      const sec =
        (await dereferenceMaybeVault(db, settings.langfuse_secret_key_ref ?? null)) ||
        Deno.env.get('LANGFUSE_SECRET_KEY') ||
        ''
      if (!pub || !sec) {
        detail = 'Add Langfuse public + secret keys (or set env vars on the host).'
      } else {
        const auth = btoa(`${pub}:${sec}`)
        const res = await fetch(`${host.replace(/\/$/, '')}/api/public/health`, {
          headers: { Authorization: `Basic ${auth}` },
          signal: AbortSignal.timeout(8_000),
        })
        httpStatus = res.status
        status = res.ok ? 'ok' : res.status === 401 ? 'down' : 'degraded'
        if (!res.ok) detail = `HTTP ${res.status}`
      }

    } else if (kind === 'anthropic') {
      // 1-token probe, costs < $0.0001.
      const key = Deno.env.get('ANTHROPIC_API_KEY') ?? ''
      if (!key) {
        detail = 'ANTHROPIC_API_KEY is not set on the server.'
      } else {
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'x-api-key': key,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model: HEALTH_PROBE_ANTHROPIC_MODEL,
            max_tokens: 1,
            messages: [{ role: 'user', content: 'ping' }],
          }),
          signal: AbortSignal.timeout(5_000),
        })
        httpStatus = res.status
        status = res.ok
          ? 'ok'
          : res.status === 401 || res.status === 403
            ? 'down'
            : 'degraded'
        if (!res.ok) {
          const body = await res.text().catch(() => '')
          detail = `HTTP ${res.status}${body ? ` — ${body.slice(0, 160)}` : ''}`
        }
      }

    } else if (kind === 'openai') {
      // 1-token probe via cheapest current-gen model.
      const key = Deno.env.get('OPENAI_API_KEY') ?? ''
      if (!key) {
        detail = 'OPENAI_API_KEY is not set on the server.'
      } else {
        const res = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${key}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: HEALTH_PROBE_OPENAI_MODEL,
            max_tokens: 1,
            messages: [{ role: 'user', content: 'ping' }],
          }),
          signal: AbortSignal.timeout(5_000),
        })
        httpStatus = res.status
        status = res.ok
          ? 'ok'
          : res.status === 401 || res.status === 403
            ? 'down'
            : 'degraded'
        if (!res.ok) {
          const body = await res.text().catch(() => '')
          detail = `HTTP ${res.status}${body ? ` — ${body.slice(0, 160)}` : ''}`
        }
      }

    } else if (kind === 'github') {
      const token =
        (await dereferenceMaybeVault(db, settings.github_installation_token_ref ?? null)) ||
        Deno.env.get('GITHUB_TOKEN') ||
        ''
      const url = settings.github_repo_url ?? ''
      // Repo names can contain dots (e.g. glot.it). Strip optional trailing `.git`.
      const match = url.match(/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/)
      if (!token || !match) {
        detail = 'Add github_repo_url and a GitHub App / PAT installation token.'
      } else {
        const [, owner, repo] = match
        const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
            'User-Agent': 'mushi-mushi-health-probe/1.0',
          },
          signal: AbortSignal.timeout(8_000),
        })
        httpStatus = res.status
        status = res.ok
          ? 'ok'
          : res.status === 401 || res.status === 403 || res.status === 404
            ? 'down'
            : 'degraded'
        if (!res.ok) detail = `HTTP ${res.status}`
      }

    } else if (kind === 'jira') {
      const baseUrl = String(routingConfig.baseUrl ?? '')
      const email = String(routingConfig.email ?? '')
      const apiToken = String(routingConfig.apiToken ?? '')
      if (!baseUrl || !email || !apiToken) {
        detail = 'Add Jira base URL, user email, and API token to enable health checks.'
      } else {
        const auth = btoa(`${email}:${apiToken}`)
        const res = await fetch(`${baseUrl.replace(/\/$/, '')}/rest/api/3/myself`, {
          headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' },
          signal: AbortSignal.timeout(8_000),
        })
        httpStatus = res.status
        status = res.ok
          ? 'ok'
          : res.status === 401 || res.status === 403
            ? 'down'
            : 'degraded'
        if (!res.ok) detail = `HTTP ${res.status}`
      }

    } else if (kind === 'linear') {
      // Resolve credential in priority order:
      //   1. Platform settings: OAuth access token (vault-backed)
      //   2. Platform settings: static API key (vault-backed)
      //   3. Legacy routing config: apiKey (project_integrations.config)
      //   4. Server env var: LINEAR_API_KEY
      let linearToken: string | null = null
      if (settings.linear_access_token_ref) {
        linearToken = await dereferenceMaybeVault(db, settings.linear_access_token_ref)
      }
      if (!linearToken && settings.linear_api_key_ref) {
        linearToken = await dereferenceMaybeVault(db, settings.linear_api_key_ref)
      }
      if (!linearToken && routingConfig.apiKey) {
        linearToken = String(routingConfig.apiKey)
      }
      if (!linearToken) {
        linearToken = Deno.env.get('LINEAR_API_KEY') ?? null
      }

      if (!linearToken) {
        detail = 'Connect a Linear workspace or add an API key to enable health checks.'
      } else {
        const res = await fetch('https://api.linear.app/graphql', {
          method: 'POST',
          headers: { Authorization: linearToken, 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: '{ viewer { id name organization { name } } }' }),
          signal: AbortSignal.timeout(8_000),
        })
        httpStatus = res.status
        if (res.ok) {
          const json = await res.json().catch(() => ({})) as {
            data?: { viewer?: { id?: string; name?: string; organization?: { name: string } } }
            errors?: Array<{ message: string }>
          }
          const workspaceName = json.data?.viewer?.organization?.name ?? json.data?.viewer?.name
          status = json.data?.viewer?.id ? 'ok' : 'degraded'
          if (status === 'ok' && workspaceName) detail = `Connected to workspace "${workspaceName}"`
          else if (status !== 'ok') detail = json.errors?.[0]?.message ?? 'Unexpected response'
        } else {
          status = res.status === 401 || res.status === 403 ? 'down' : 'degraded'
          detail = `HTTP ${res.status}`
        }
      }

    } else if (kind === 'github_issues') {
      const token = String(routingConfig.token ?? '')
      const owner = String(routingConfig.owner ?? '')
      const repo = String(routingConfig.repo ?? '')
      if (!token || !owner || !repo) {
        detail = 'Add GitHub token, owner, and repo name to enable health checks.'
      } else {
        const res = await fetch(
          `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: 'application/vnd.github+json',
              'X-GitHub-Api-Version': '2022-11-28',
              'User-Agent': 'mushi-mushi-health-probe/1.0',
            },
            signal: AbortSignal.timeout(8_000),
          },
        )
        httpStatus = res.status
        status = res.ok
          ? 'ok'
          : res.status === 401 || res.status === 403 || res.status === 404
            ? 'down'
            : 'degraded'
        if (!res.ok) detail = `HTTP ${res.status}`
      }

    } else if (kind === 'pagerduty') {
      const routingKey = String(routingConfig.routingKey ?? '')
      if (!routingKey) {
        detail = 'Add PagerDuty routing key to enable health checks.'
      } else {
        // Resolve a non-existent alert — PD returns 202 even for unknown
        // dedup_keys on resolve, so this is a safe no-op probe.
        const fakeDedup = `mushi-health-probe-${Date.now()}`
        const res = await fetch('https://events.pagerduty.com/v2/enqueue', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            routing_key: routingKey,
            event_action: 'resolve',
            dedup_key: fakeDedup,
            payload: {
              summary: 'Mushi health probe',
              severity: 'info',
              source: 'mushi-mushi-health-probe',
            },
          }),
          signal: AbortSignal.timeout(8_000),
        })
        httpStatus = res.status
        // PD resolve returns 202 for any accepted routing key; 400 = bad key.
        status = res.status === 202 ? 'ok' : res.status === 400 ? 'down' : 'degraded'
        if (status !== 'ok') detail = `HTTP ${res.status}`
      }
    }
  } catch (err) {
    status = 'down'
    detail = String(err).slice(0, 200)
  }

  // ── reward_webhook ────────────────────────────────────────────────────────
  if (kind === 'reward_webhook') {
    const url = routingConfig['webhook_url'] as string | undefined
    const secretHash = routingConfig['secret_hash'] as string | undefined

    if (!url) {
      detail = 'No webhook URL configured — add one in Rewards → Settings.'
    } else {
      // Send a signed ping event. The host should return 2xx; any other status
      // surfaces as degraded. We don't require the host to process pings —
      // just that the endpoint is reachable.
      const body = JSON.stringify({ event: 'reward.health_ping', timestamp: new Date().toISOString() })
      let sig = 'none'
      if (secretHash) {
        // secretHash is stored as hex-encoded HMAC key (first 16 chars = probe ID)
        sig = `sha256=probe-${secretHash.slice(0, 16)}`
      }
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Mushi-Signature-256': sig,
            'X-Mushi-Event': 'reward.health_ping',
          },
          body,
          signal: AbortSignal.timeout(8_000),
        })
        httpStatus = res.status
        if (res.status >= 200 && res.status < 300) {
          status = 'ok'
          detail = `Endpoint reachable — ${res.status}`
        } else if (res.status === 401 || res.status === 403) {
          // Signature mismatch is expected since we don't have the plaintext secret;
          // treat a 4xx as "reachable but signature rejected" → degraded, not down.
          status = 'degraded'
          detail = `Endpoint reachable but rejected probe (${res.status}). Signature verification working.`
        } else if (res.status >= 500) {
          status = 'down'
          detail = `Host webhook endpoint returned ${res.status}`
        } else {
          status = 'degraded'
          detail = `Unexpected response: ${res.status}`
        }
      } catch (err) {
        status = 'down'
        detail = `Connection failed: ${String(err)}`
      }
    }
  }

  // ── cursor_cloud ──────────────────────────────────────────────────────────
  if (kind === 'cursor_cloud') {
    const apiKey =
      (await dereferenceMaybeVault(db, settings.cursor_api_key_ref ?? null)) ||
      Deno.env.get('CURSOR_API_KEY') ||
      ''
    if (!apiKey) {
      status = 'unknown'
      detail = 'No Cursor API key configured. Paste your crsr_… key under Integrations → Cursor Cloud.'
    } else {
      try {
        const res = await fetch('https://api.cursor.com/v0/me', {
          headers: { Authorization: `Bearer ${apiKey}`, 'User-Agent': 'mushi-mushi-health-probe/1.0' },
          signal: AbortSignal.timeout(8_000),
        })
        httpStatus = res.status
        if (res.ok) {
          const data = await res.json() as { email?: string; username?: string; user?: { email?: string } }
          status = 'ok'
          detail = `Connected as ${data.email ?? data.user?.email ?? data.username ?? 'Cursor account'}`
        } else if (res.status === 401 || res.status === 403) {
          status = 'down'
          detail = 'API key invalid or revoked. Regenerate at cursor.com/dashboard/integrations.'
        } else {
          status = 'degraded'
          detail = `HTTP ${res.status}`
        }
      } catch (err) {
        status = 'down'
        detail = String(err)
      }
    }
  }

  // ── claude_code_agent ─────────────────────────────────────────────────────
  if (kind === 'claude_code_agent') {
    const apiKey =
      (await dereferenceMaybeVault(db, settings.claude_api_key_ref ?? null)) ||
      Deno.env.get('ANTHROPIC_API_KEY') ||
      ''
    if (!apiKey) {
      status = 'unknown'
      detail = 'No Anthropic API key configured. Add ANTHROPIC_API_KEY to your environment or under Settings → API Keys.'
    } else {
      try {
        // Minimal models list call — cheapest probe with no tokens consumed
        const res = await fetch('https://api.anthropic.com/v1/models', {
          headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'User-Agent': 'mushi-mushi-health-probe/1.0',
          },
          signal: AbortSignal.timeout(8_000),
        })
        httpStatus = res.status
        if (res.ok) {
          status = 'ok'
          detail = 'Anthropic API key valid — Claude Code agent can connect.'
        } else if (res.status === 401 || res.status === 403) {
          status = 'down'
          detail = 'API key invalid or revoked. Generate a new key at console.anthropic.com.'
        } else {
          status = 'degraded'
          detail = `HTTP ${res.status}`
        }
      } catch (err) {
        status = 'down'
        detail = String(err)
      }
    }
  }

  // ── slack ─────────────────────────────────────────────────────────────────
  if (kind === 'slack') {
    // Try per-project vaulted token (from settings), then env fallback
    const ref = settings.slack_bot_token_ref
      ? `vault://${settings.slack_bot_token_ref}`
      : null
    let botToken: string | null = await dereferenceMaybeVault(db, ref)
    if (!botToken) botToken = Deno.env.get('SLACK_BOT_TOKEN') ?? null

    if (!botToken) {
      status = 'unknown'
      detail = 'No Slack bot token configured. Click "Add to Slack" to connect.'
    } else {
      try {
        const t0 = Date.now()
        const res = await fetch('https://slack.com/api/auth.test', {
          headers: { Authorization: `Bearer ${botToken}` },
        })
        httpStatus = res.status
        const data = await res.json() as { ok: boolean; team?: string; bot_id?: string; error?: string }
        if (data.ok) {
          status = 'ok'
          detail = `Connected to workspace "${data.team ?? '?'}" as bot ${data.bot_id ?? '?'} (${Date.now() - t0}ms)`
        } else {
          status = 'down'
          detail = `Slack auth.test error: ${data.error ?? 'unknown'}`
        }
      } catch (err) {
        status = 'down'
        detail = String(err)
      }
    }
  }

  return { status, detail, httpStatus, latencyMs: Date.now() - start }
}

// ── Linear probe ──────────────────────────────────────────────────────────────

/**
 * Probe the Linear API using either the OAuth access token or the static API key
 * stored in project_settings (vault-backed). Returns the connected workspace name
 * on success so the console card can display it without a separate fetch.
 */
export async function probeLinear(
  settings: PlatformSettings,
  db: SupabaseClient,
): Promise<ProbeResult & { workspaceName?: string }> {
  const start = Date.now()
  let status: ProbeResult['status'] = 'unknown'
  let detail = ''
  let httpStatus = 0
  let workspaceName: string | undefined

  // Resolve credential: OAuth access token wins over static API key.
  let token: string | null = null
  const accessRef = settings.linear_access_token_ref
  if (accessRef) {
    token = await dereferenceMaybeVault(db, accessRef)
  }
  if (!token) {
    const keyRef = settings.linear_api_key_ref
    if (keyRef) {
      token = await dereferenceMaybeVault(db, keyRef)
    }
  }
  if (!token) {
    token = Deno.env.get('LINEAR_API_KEY') ?? null
  }

  if (!token) {
    status = 'unknown'
    detail = 'No Linear API key or OAuth token configured. Connect via the Integrations page.'
    return { status, detail, httpStatus, latencyMs: Date.now() - start }
  }

  try {
    const t0 = Date.now()
    const res = await fetch('https://api.linear.app/graphql', {
      method: 'POST',
      headers: {
        Authorization: token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: `query { viewer { id name organization { name urlKey } } }`,
      }),
    })
    httpStatus = res.status
    if (!res.ok) {
      status = 'down'
      detail = `Linear API HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`
      return { status, detail, httpStatus, latencyMs: Date.now() - start }
    }
    const data = await res.json() as {
      data?: { viewer?: { id: string; name: string; organization?: { name: string; urlKey: string } } }
      errors?: Array<{ message: string }>
    }
    if (data.errors?.length) {
      status = 'down'
      detail = `Linear GraphQL error: ${data.errors.map((e) => e.message).join('; ')}`
    } else if (data.data?.viewer) {
      const org = data.data.viewer.organization
      workspaceName = org?.name ?? data.data.viewer.name
      status = 'ok'
      detail = `Connected to workspace "${workspaceName}" (${Date.now() - t0}ms)`
    } else {
      status = 'down'
      detail = 'Linear returned no viewer data'
    }
  } catch (err) {
    status = 'down'
    detail = String(err)
  }

  return { status, detail, httpStatus, latencyMs: Date.now() - start, workspaceName }
}
