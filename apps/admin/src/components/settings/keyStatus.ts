/**
 * FILE: apps/admin/src/components/settings/keyStatus.ts
 * PURPOSE: One plain-English status for every saved AI or service key, in the
 *          ConnectionStatus language (Working / Needs attention / Expires in
 *          N days / Not connected / Not checked yet), plus the one thing to
 *          do about it. Pure, so the page banner, the tab badge and each row
 *          read the same answer from the same key list and can't disagree.
 *
 *   ok, in use                       → working   "Verified 2h ago"
 *   provider rejected it (auth)      → attention "The provider rejected this key — replace it"
 *   out of quota, still cooling down → attention "Out of quota — add another key or wait until 3:40 PM"
 *   provider unreachable on the test → attention "Couldn't reach … test again"
 *   saved, never tested              → checking  "Not checked yet"
 *   turned off by the owner          → not_connected "Turned off"
 *   expired                          → attention "Expired on … — replace it"
 *   expires within 7 days            → expiring  "Expires in N days"
 *   old single key next to a working
 *   pooled key of the same provider  → attention "Old key, replaced by your newer one — remove it"
 *   rejected or expired, while another
 *   key of the provider works        → attention, action Remove (it was already replaced)
 *
 * The server counts keys with the same rules (_shared/byok-key-health.ts);
 * packages/server/src/__tests__/byok-key-health-parity.test.ts runs both on the
 * same fixtures. Change both together.
 */

import type { ConnectionState } from '../ui/ConnectionStatus'
import { relativeTime } from '../../lib/setupGuideSteps'
import { isRuntimeEligiblePoolKey, type PoolKey, type PoolKeyStatus, type PoolTestStatus } from './byokPool'

/** A key from the old one-key-per-provider columns, as GET /v1/admin/byok/keys lists it. */
export interface LegacyKey {
  id: string
  provider_slug: string
  label: string
  status: PoolKeyStatus
  test_status: PoolTestStatus | null
  cooldown_until: null
  key_hint: string | null
  base_url: string | null
  last_tested_at: string | null
  last_used_at: string | null
  created_at: string | null
  legacy: true
}

export type ManagedKey = PoolKey | LegacyKey

export function isLegacyKey(key: ManagedKey): key is LegacyKey {
  return 'legacy' in key && key.legacy === true
}

/** What the row's main button does. */
export type KeyAction = 'replace' | 'remove' | 'test' | 'enable' | 'add_backup' | null

export interface KeyStatusView {
  state: ConnectionState
  /** Overrides the default ConnectionStatus label when the state needs a sharper word. */
  label?: string
  detail: string
  action: KeyAction
  /** Set on an expiring key so the chip can say "Expires in N days". */
  expiresAt?: string | null
}

const DAY_MS = 24 * 60 * 60 * 1000
/** Owner asked for a week's warning before a key lapses. */
export const KEY_EXPIRY_WARN_DAYS = 7

function formatClock(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' })
}

/** A pooled key of this provider is the one the runtime will actually use. */
export function hasWorkingPoolKey(keys: readonly PoolKey[], provider: string, now = Date.now()): boolean {
  return keys.some((k) => k.provider_slug === provider && isRuntimeEligiblePoolKey(k, now))
}

/** Another key of the same provider works, so this one has been replaced. */
function replacedByAnother(key: ManagedKey, pool: readonly PoolKey[], now: number): boolean {
  return pool.some(
    (k) =>
      k.id !== key.id &&
      k.provider_slug === key.provider_slug &&
      isRuntimeEligiblePoolKey(k, now) &&
      !(k.expires_at && Date.parse(k.expires_at) <= now),
  )
}

export function keyStatusView(
  key: ManagedKey,
  context: { pool: readonly PoolKey[]; now?: number; providerName?: string },
): KeyStatusView {
  const now = context.now ?? Date.now()
  const provider = context.providerName ?? 'the provider'

  if (isLegacyKey(key) && hasWorkingPoolKey(context.pool, key.provider_slug, now)) {
    return {
      state: 'attention',
      label: 'Old key',
      detail: 'Old key, replaced by your newer one — remove it.',
      action: 'remove',
    }
  }

  const expiresAt = isLegacyKey(key) ? null : (key.expires_at ?? null)
  const expiresMs = expiresAt ? Date.parse(expiresAt) : NaN
  if (Number.isFinite(expiresMs) && expiresMs <= now) {
    return replacedByAnother(key, context.pool, now)
      ? {
          state: 'attention',
          label: 'Expired',
          detail: `Expired on ${formatDay(expiresAt!)}. Another key is working, so remove this one.`,
          action: 'remove',
        }
      : {
          state: 'attention',
          label: 'Expired',
          detail: `Expired on ${formatDay(expiresAt!)} — replace it with a new key.`,
          action: 'replace',
        }
  }

  if (key.status === 'disabled') {
    return {
      state: 'not_connected',
      label: 'Turned off',
      detail: "You turned this key off, so Mushi won't use it.",
      action: key.test_status === 'ok' ? 'enable' : 'test',
    }
  }

  if (key.test_status === 'error_auth' || key.status === 'auth_failed') {
    return replacedByAnother(key, context.pool, now)
      ? {
          state: 'attention',
          detail: 'The provider rejected this key. Another key is working, so remove this one.',
          action: 'remove',
        }
      : {
          state: 'attention',
          detail: 'The provider rejected this key — replace it.',
          action: 'replace',
        }
  }

  if (key.test_status === 'error_quota' || key.status === 'quota_exhausted') {
    const cooling = key.cooldown_until && Date.parse(key.cooldown_until) > now
    if (cooling || isLegacyKey(key) || !isRuntimeEligiblePoolKey(key, now)) {
      return {
        state: 'attention',
        label: 'Out of quota',
        detail: cooling
          ? `Out of quota — add another key or wait until ${formatClock(key.cooldown_until!)}.`
          : 'Out of quota — add another key or wait until your provider resets it.',
        action: 'add_backup',
      }
    }
    // Cooldown over: the runtime is trying it again, same as any working key.
  }

  if (key.test_status === 'error_network') {
    return {
      state: 'attention',
      detail: `Mushi couldn't reach ${provider} to check this key. Test it again in a minute.`,
      action: 'test',
    }
  }

  if (key.test_status !== 'ok' && key.test_status !== 'error_quota') {
    return {
      state: 'checking',
      detail: "Mushi hasn't confirmed this key works yet. Test it.",
      action: 'test',
    }
  }

  if (Number.isFinite(expiresMs) && expiresMs - now <= KEY_EXPIRY_WARN_DAYS * DAY_MS) {
    return {
      state: 'expiring',
      detail: `Works until ${formatDay(expiresAt!)}. Create a new key before then and add it here.`,
      action: 'replace',
      expiresAt,
    }
  }

  const verified = relativeTime(key.last_tested_at, now)
  const used = relativeTime(key.last_used_at, now)
  return {
    state: 'working',
    detail: [verified ? `Verified ${verified}` : 'Verified', used ? `last used ${used}` : null]
      .filter(Boolean)
      .join(' · '),
    action: null,
  }
}

export interface KeySummary {
  working: number
  attention: number
  expiring: number
  checking: number
  off: number
  total: number
}

/** Counts across every saved key, for the page banner and the tab badge. */
export function summarizeKeys(
  pool: readonly PoolKey[],
  legacy: readonly LegacyKey[],
  now = Date.now(),
): KeySummary {
  const summary: KeySummary = { working: 0, attention: 0, expiring: 0, checking: 0, off: 0, total: 0 }
  for (const key of [...pool, ...legacy]) {
    const { state } = keyStatusView(key, { pool, now })
    summary.total += 1
    if (state === 'working') summary.working += 1
    else if (state === 'attention') summary.attention += 1
    else if (state === 'expiring') summary.expiring += 1
    else if (state === 'checking') summary.checking += 1
    else summary.off += 1
  }
  return summary
}

/**
 * The provider-level status shown on a provider row: the best key decides
 * whether the provider works, and any problem key is still called out.
 */
export function providerStatusView(
  provider: string,
  pool: readonly PoolKey[],
  legacy: readonly LegacyKey[],
  options: { now?: number; providerName?: string; emptyDetail: string },
): KeyStatusView {
  const now = options.now ?? Date.now()
  const keys: ManagedKey[] = [
    ...pool.filter((k) => k.provider_slug === provider),
    ...legacy.filter((k) => k.provider_slug === provider),
  ]
  if (keys.length === 0) {
    return { state: 'not_connected', detail: options.emptyDetail, action: null }
  }
  const views = keys.map((k) => keyStatusView(k, { pool, now, providerName: options.providerName }))
  const problems = views.filter((v) => v.state === 'attention').length
  const working = views.find((v) => v.state === 'working')
  if (working) {
    if (problems > 0) {
      return {
        state: 'attention',
        detail: `Working, but ${problems === 1 ? 'one key needs' : `${problems} keys need`} your attention below.`,
        action: null,
      }
    }
    const expiring = views.find((v) => v.state === 'expiring')
    return expiring ?? working
  }
  const order: ConnectionState[] = ['attention', 'expiring', 'checking', 'not_connected']
  for (const state of order) {
    const hit = views.find((v) => v.state === state)
    if (hit) return hit
  }
  return views[0]!
}
