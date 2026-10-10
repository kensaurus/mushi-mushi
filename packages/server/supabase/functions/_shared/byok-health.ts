/**
 * FILE: packages/server/supabase/functions/_shared/byok-health.ts
 * PURPOSE: Probe the keys customers stored in `byok_keys` from the
 *          integration-health-probe cron (Plan 020 P-1).
 *
 * The cron used to probe only the platform's own env keys, on one anchor
 * project. A customer's revoked Anthropic or OpenAI key stayed "active" until
 * an LLM call happened to fail on it, and nothing on /integrations said so.
 *
 * Cadence: each key is probed at most once per BYOK_PROBE_INTERVAL_MS. The
 * Firecrawl probe runs a real (paid) search, so a 15-minute cadence would
 * spend the customer's credits.
 *
 * Status changes follow the manual "Test key" route: 401/403 marks the key
 * auth_failed, 429 marks it quota_exhausted, a 2xx makes it active again. A
 * network error changes nothing — a working key must not drop out of the
 * pool because the provider was briefly unreachable.
 *
 * Pure apart from the injected `fetcher`; no Deno globals, so a Deno test can
 * drive it with a fixture.
 */

import { BYOK_PROVIDERS, probeByokKey, type ByokProbeResult, type ByokProvider } from './byok-validation.ts'
import { isSupabaseProjectRef } from './supabase-project-ref.ts'

export const BYOK_PROBE_INTERVAL_MS = 24 * 60 * 60 * 1000

export interface ByokKeyRow {
  id: string
  /** Null for an organization's shared key (ADR 0023). */
  project_id: string | null
  provider_slug: string
  vault_secret_id: string | null
  base_url: string | null
  label: string | null
  key_hint: string | null
  status: string
  test_status: string | null
  last_tested_at: string | null
  last_error: string | null
  /**
   * Supabase tokens only: the owning project's `supabase_project_ref`, joined
   * in by the cron. The token is checked against that one project.
   */
  supabase_project_ref?: string | null
}

/** `integration_health_history.status` values (see its CHECK constraint). */
export type HealthStatus = 'ok' | 'degraded' | 'down' | 'unknown'

/** Keys the cron should probe now: enabled, a provider we can probe, and due. */
export function selectDueByokKeys(rows: ByokKeyRow[], nowMs: number): ByokKeyRow[] {
  return rows.filter((r) => {
    if (r.status === 'disabled') return false
    if (!(BYOK_PROVIDERS as readonly string[]).includes(r.provider_slug)) return false
    // A Supabase token without a linked project has nothing to be checked
    // against; probing it daily would only log "unreachable" noise.
    if (r.provider_slug === 'supabase' && !isSupabaseProjectRef(r.supabase_project_ref)) return false
    if (!r.last_tested_at) return true
    return nowMs - new Date(r.last_tested_at).getTime() >= BYOK_PROBE_INTERVAL_MS
  })
}

export interface ByokProbeOutcome {
  key: ByokKeyRow
  health: HealthStatus
  detail: string
  /** The byok_keys patch to write, or null to leave the row untouched. */
  patch: Record<string, unknown> | null
}

/** Map one probe result onto the health row and the byok_keys update. */
export function outcomeFromProbe(key: ByokKeyRow, probe: ByokProbeResult, nowIso: string): ByokProbeOutcome {
  const name = key.label || key.key_hint || key.provider_slug
  switch (probe.status) {
    case 'ok':
      return {
        key,
        health: 'ok',
        detail: `${name}: ${probe.detail}`,
        patch: {
          status: 'active',
          test_status: 'ok',
          last_tested_at: nowIso,
          last_error: null,
          cooldown_until: null,
        },
      }
    case 'error_auth':
      return {
        key,
        health: 'down',
        detail: `${name}: the provider rejected this key (HTTP ${probe.httpStatus}). It was revoked or mistyped — add a new one in Settings → API Keys.`,
        patch: {
          status: 'auth_failed',
          test_status: 'error_auth',
          last_tested_at: nowIso,
          last_error: `HTTP ${probe.httpStatus}: ${probe.detail}`,
        },
      }
    case 'error_quota':
      return {
        key,
        health: 'degraded',
        detail: `${name}: the provider accepted the key but the account is out of quota (HTTP ${probe.httpStatus}).`,
        patch: {
          status: 'quota_exhausted',
          test_status: 'error_quota',
          last_tested_at: nowIso,
          last_error: `HTTP ${probe.httpStatus}: ${probe.detail}`,
          cooldown_until: new Date(new Date(nowIso).getTime() + 60 * 60 * 1000).toISOString(),
        },
      }
    default:
      // Network trouble or an unexpected status says nothing about the key.
      return {
        key,
        health: 'degraded',
        detail: `${name}: could not reach the provider to check this key (${probe.detail}).`,
        patch: null,
      }
  }
}

/** A key whose secret could not be read from Vault is unusable: report it, do not guess. */
export function outcomeForUnreadableKey(key: ByokKeyRow, nowIso: string): ByokProbeOutcome {
  const name = key.label || key.key_hint || key.provider_slug
  return {
    key,
    health: 'down',
    detail: `${name}: the stored key could not be read from Vault. Add it again in Settings → API Keys.`,
    patch: {
      status: 'auth_failed',
      test_status: 'error_auth',
      last_tested_at: nowIso,
      last_error: 'vault secret unreadable',
    },
  }
}

export async function probeByokRow(
  key: ByokKeyRow,
  secret: string | null,
  nowIso: string,
  fetcher: typeof fetch = fetch,
): Promise<ByokProbeOutcome> {
  if (!secret) return outcomeForUnreadableKey(key, nowIso)
  const probe = await probeByokKey(
    key.provider_slug as ByokProvider,
    secret,
    key.provider_slug === 'openai' ? (key.base_url ?? undefined) : undefined,
    fetcher,
    { supabaseProjectRef: key.supabase_project_ref ?? null },
  )
  return outcomeFromProbe(key, probe, nowIso)
}

const SEVERITY: Record<HealthStatus, number> = { ok: 0, unknown: 1, degraded: 2, down: 3 }

/**
 * One health row per (project, provider), carrying the worst key's status.
 * Writing a row per key let a healthy key's row land "latest" and hide a
 * revoked one, because the console reads only the newest row per kind.
 */
export function healthRowsFromOutcomes(
  outcomes: ByokProbeOutcome[],
): Array<{ project_id: string; kind: string; status: HealthStatus; latency_ms: number; message: string; source: 'cron' }> {
  const groups = new Map<string, ByokProbeOutcome[]>()
  for (const o of outcomes) {
    // A shared key belongs to no single project: its probe result lives on
    // the key row (status, test_status), not in one app's health history.
    if (!o.key.project_id) continue
    const k = `${o.key.project_id}|${o.key.provider_slug}`
    groups.set(k, [...(groups.get(k) ?? []), o])
  }
  return [...groups.values()].map((group) => {
    const worst = group.reduce((a, b) => (SEVERITY[b.health] > SEVERITY[a.health] ? b : a))
    const problems = group.filter((o) => o.health !== 'ok').map((o) => o.detail)
    return {
      project_id: worst.key.project_id as string,
      kind: worst.key.provider_slug,
      status: worst.health,
      latency_ms: 0,
      message: (problems.length > 0 ? problems.join(' ') : worst.detail).slice(0, 1000),
      source: 'cron' as const,
    }
  })
}
