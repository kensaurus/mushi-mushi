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

export const PLATFORM_KINDS: IntegrationKind[] = ['sentry', 'langfuse', 'github', 'anthropic', 'openai']
export const ROUTING_KINDS: IntegrationKind[] = ['jira', 'linear', 'github_issues', 'pagerduty', 'reward_webhook']
export const ALL_INTEGRATION_KINDS: IntegrationKind[] = [...PLATFORM_KINDS, ...ROUTING_KINDS]

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
      const apiKey = String(routingConfig.apiKey ?? '')
      if (!apiKey) {
        detail = 'Add Linear API key to enable health checks.'
      } else {
        const res = await fetch('https://api.linear.app/graphql', {
          method: 'POST',
          headers: { Authorization: apiKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: '{ viewer { id } }' }),
          signal: AbortSignal.timeout(8_000),
        })
        httpStatus = res.status
        if (res.ok) {
          const json = await res.json().catch(() => ({})) as { data?: { viewer?: { id?: string } }; errors?: Array<{ message: string }> }
          status = json.data?.viewer?.id ? 'ok' : 'degraded'
          if (status !== 'ok') detail = json.errors?.[0]?.message ?? 'Unexpected response'
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

  return { status, detail, httpStatus, latencyMs: Date.now() - start }
}
