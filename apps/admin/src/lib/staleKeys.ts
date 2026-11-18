/**
 * FILE: apps/admin/src/lib/staleKeys.ts
 * PURPOSE: Which SDK keys Connect's one "Revoke N stale keys" action removes
 *          (owner, 2026-11-18). Long-lived apps pile up e2e and test keys.
 *
 *          Stale here is stricter than the key list's "Stale" chip (quiet for
 *          an hour, normal for a small app): a key no app has used for over
 *          7 days (the "Cold" chip), or one never used and made more than 7
 *          days ago. Never revoked:
 *            - the key most recently heard from (the one the app runs on);
 *            - MCP, CLI or other non-SDK keys (lib/heartbeat isSdkKeyScopes);
 *            - `ci-auto:*` keys, which a shipped native build can carry;
 *            - rows with no real id (the panel's bare-prefix fallback).
 */
import { SDK_COLD_MS, isSdkKeyScopes } from './heartbeat'

export interface StaleKeyCandidate {
  id: string
  key_prefix: string
  label?: string | null
  scopes?: string[] | null
  is_active: boolean
  created_at: string
  last_seen_at?: string | null
}

const ms = (iso: string | null | undefined): number => {
  const t = iso ? Date.parse(iso) : NaN
  return Number.isFinite(t) ? t : NaN
}

export function staleKeysToRevoke<K extends StaleKeyCandidate>(keys: readonly K[], now = Date.now()): K[] {
  const newestSeen = keys
    .filter((k) => Number.isFinite(ms(k.last_seen_at)))
    .sort((a, b) => ms(b.last_seen_at) - ms(a.last_seen_at))[0]
  return keys.filter((k) => {
    if (!k.is_active || k.id === k.key_prefix || k === newestSeen) return false
    if (!isSdkKeyScopes(k.scopes)) return false
    if ((k.label ?? '').startsWith('ci-auto:')) return false
    const seen = ms(k.last_seen_at)
    if (Number.isFinite(seen)) return now - seen > SDK_COLD_MS
    const made = ms(k.created_at)
    return Number.isFinite(made) && now - made > SDK_COLD_MS
  })
}
