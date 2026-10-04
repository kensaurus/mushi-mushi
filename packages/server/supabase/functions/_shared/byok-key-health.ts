/**
 * FILE: packages/server/supabase/functions/_shared/byok-key-health.ts
 * PURPOSE: One verdict per saved provider key, for the counts the settings
 *          stats route serves (sidebar badge, page hero, Developer details).
 *
 *          The console decides each key row's status with the same rules in
 *          apps/admin/src/components/settings/keyStatus.ts, and
 *          src/__tests__/byok-key-health-parity.test.ts runs both on the same
 *          fixtures, so the badge and the rows can't disagree. Change both
 *          together.
 *
 *   superseded legacy key (a pooled key of the provider works) → attention
 *   expired (expires_at passed)                                → attention
 *   turned off                                                 → off
 *   rejected by the provider                                   → attention
 *   out of quota and still cooling down                        → attention
 *   provider unreachable on the last test                      → attention
 *   never accepted                                             → checking
 *   expires within 7 days                                      → expiring
 *   otherwise                                                  → working
 */

export type ByokKeyHealth = 'working' | 'attention' | 'expiring' | 'checking' | 'off'

export interface ByokKeyHealthInput {
  provider_slug: string
  status: string
  test_status: string | null
  cooldown_until?: string | null
  expires_at?: string | null
  /** A key in the old one-key-per-provider project_settings columns. */
  legacy?: boolean
}

const DAY_MS = 24 * 60 * 60 * 1000
export const BYOK_EXPIRY_WARN_DAYS = 7

/** Same rule as the runtime resolver and the console's isRuntimeEligiblePoolKey. */
function isRuntimeEligible(key: ByokKeyHealthInput, now: number): boolean {
  if (key.legacy) return false
  if (key.status !== 'active' && key.status !== 'quota_exhausted') return false
  if (key.test_status !== 'ok' && key.test_status !== 'error_quota') return false
  if (!key.cooldown_until) return true
  const until = Date.parse(key.cooldown_until)
  return Number.isFinite(until) && until <= now
}

export function byokKeyHealth(
  key: ByokKeyHealthInput,
  all: readonly ByokKeyHealthInput[],
  now: number = Date.now(),
): ByokKeyHealth {
  const poolWorks = all.some((k) => k.provider_slug === key.provider_slug && isRuntimeEligible(k, now))
  if (key.legacy && poolWorks) return 'attention'

  const expires = key.legacy || !key.expires_at ? NaN : Date.parse(key.expires_at)
  if (Number.isFinite(expires) && expires <= now) return 'attention'

  if (key.status === 'disabled') return 'off'
  if (key.test_status === 'error_auth' || key.status === 'auth_failed') return 'attention'

  if (key.test_status === 'error_quota' || key.status === 'quota_exhausted') {
    const cooling = key.cooldown_until ? Date.parse(key.cooldown_until) > now : false
    if (cooling || key.legacy || !isRuntimeEligible(key, now)) return 'attention'
  }

  if (key.test_status === 'error_network') return 'attention'
  if (key.test_status !== 'ok' && key.test_status !== 'error_quota') return 'checking'
  if (Number.isFinite(expires) && expires - now <= BYOK_EXPIRY_WARN_DAYS * DAY_MS) return 'expiring'
  return 'working'
}

export interface ByokHealthCounts {
  working: number
  attention: number
  expiring: number
  checking: number
  off: number
}

export function countByokKeyHealth(
  keys: readonly ByokKeyHealthInput[],
  now: number = Date.now(),
): ByokHealthCounts {
  const counts: ByokHealthCounts = { working: 0, attention: 0, expiring: 0, checking: 0, off: 0 }
  for (const key of keys) counts[byokKeyHealth(key, keys, now)] += 1
  return counts
}

/** The status a legacy single-key slot reports, from its stored test result. */
export function legacyKeyStatus(testStatus: string | null): string {
  if (testStatus === 'ok') return 'active'
  if (testStatus === 'error_quota') return 'quota_exhausted'
  if (testStatus === 'error_auth') return 'auth_failed'
  return 'pending_validation'
}
