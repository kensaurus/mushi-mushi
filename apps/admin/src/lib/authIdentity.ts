/**
 * FILE: apps/admin/src/lib/authIdentity.ts
 * PURPOSE: Small, shared helpers for deriving human-facing identity from a
 *          Supabase User/Session — provider, initials, display name, avatar.
 *          Extracted from SidebarUserCard so the multi-account session store
 *          (accountSessions.ts) and the sidebar card render identity the same
 *          way instead of duplicating the app_metadata/user_metadata plumbing.
 */

import type { User } from '@supabase/supabase-js'

export type AuthProvider = 'google' | 'apple' | 'email' | 'github' | 'unknown'

export function detectProvider(user: User | null): AuthProvider {
  if (!user) return 'unknown'
  // Supabase exposes the most-recent provider on `app_metadata.provider` and
  // the full set on `app_metadata.providers`. Prefer the explicit `provider`
  // field — the one the user signed in with on the current session — and fall
  // back to identities[0] for sessions migrated from older auth schemas.
  const fromAppMeta = (user.app_metadata as { provider?: string })?.provider
  const candidate = fromAppMeta ?? user.identities?.[0]?.provider ?? 'email'
  switch (candidate) {
    case 'google':
    case 'apple':
    case 'email':
    case 'github':
      return candidate
    default:
      return 'unknown'
  }
}

export function displayNameFor(user: User | null): string | null {
  if (!user) return null
  const meta = user.user_metadata as { full_name?: string; name?: string } | undefined
  const name = meta?.full_name ?? meta?.name ?? null
  return name?.trim() || null
}

export function initialsFromName(name: string | null | undefined): string {
  const trimmed = (name ?? '').trim()
  if (!trimmed) return '?'
  // Multi-word → first letter of first two words; single word (typical for
  // emails) → first two characters.
  const parts = trimmed.split(/[\s@._-]+/).filter(Boolean)
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase()
  }
  return trimmed.slice(0, 2).toUpperCase()
}

export function initialsFor(user: User | null): string {
  if (!user) return '?'
  return initialsFromName(displayNameFor(user) ?? user.email)
}

export function avatarUrlFor(user: User | null): string | null {
  return (user?.user_metadata as { avatar_url?: string })?.avatar_url ?? null
}
