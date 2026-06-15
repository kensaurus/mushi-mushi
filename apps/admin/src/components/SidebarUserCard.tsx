/**
 * FILE: apps/admin/src/components/SidebarUserCard.tsx
 * PURPOSE: Bottom of the sidebar — identity + sign-out. Replaces the
 *          earlier two-row footer (`<div>{email}</div>` + plain Sign-out
 *          button) with a single integrated card:
 *
 *            [avatar] [email + provider chip] [rose sign-out icon]
 *
 *          What changed and why:
 *
 *          • Avatar — a 24×24 round disc, painted with the OAuth
 *            provider's colour (Google red / Apple black / email warm
 *            grey) when no portrait URL is present, or the OAuth
 *            avatar_url image when it is. Visual identity beats
 *            text-only "test@example.com" — users recognise their own
 *            face / G-circle faster than any string.
 *
 *          • Email — promoted from `text-fg-muted` (the previous near-
 *            invisible grey) to `text-fg-secondary` so the user's
 *            identity actually reads as identity, not metadata. Bold-
 *            adjacent weight (`font-medium`) without using `text-fg`
 *            (which would compete with nav items for primacy).
 *
 *          • Provider chip — tiny google / apple / mail icon to the
 *            right of the email tells the user *how they signed in*,
 *            which matters when the same operator has both an SSO
 *            and a magic-link account on the same Mushi project. Not
 *            shown when provider isn't determinable (e.g. anonymous
 *            test session).
 *
 *          • Plan / tier — mirrored from the old header `PlanBadge` so
 *            hobby / starter / pro / Admin (complimentary) stays visible next
 *            to identity without crowding the top bar.
 *
 *          • Sign out — moved into this card as a small rose icon
 *            button (the user explicitly asked for "pink"; the rose
 *            token reads as "destructive but not alarming" — calmer
 *            than `--color-danger` which Mushi uses for failed fixes).
 *            Click opens a `ConfirmDialog` so accidental sign-outs
 *            (an extremely common 3am-on-call mistake) are caught.
 */

import { useState, type ReactElement } from 'react'
import type { User } from '@supabase/supabase-js'
import { ConfirmDialog } from './ConfirmDialog'
import { PlanBadge } from './PlanBadge'

type AuthProvider = 'google' | 'apple' | 'email' | 'github' | 'unknown'

function detectProvider(user: User | null): AuthProvider {
  if (!user) return 'unknown'
  // Supabase exposes the most-recent provider on `app_metadata.provider`
  // and the full set on `app_metadata.providers`. Prefer the explicit
  // `provider` field — that's the one the user signed in with on the
  // current session — and fall back to identities[0] if it's missing
  // (which can happen for sessions migrated from older auth schemas).
  const fromAppMeta = (user.app_metadata as { provider?: string })?.provider
  const candidate =
    fromAppMeta ??
    user.identities?.[0]?.provider ??
    'email'
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

function initialsFor(user: User | null): string {
  if (!user) return '?'
  const name = (user.user_metadata as { full_name?: string; name?: string })?.full_name
    ?? (user.user_metadata as { name?: string })?.name
    ?? user.email
    ?? ''
  const trimmed = name.trim()
  if (!trimmed) return '?'
  // Multi-word → use first letter of first two words; single word
  // (typical for emails) → take first two characters.
  const parts = trimmed.split(/[\s@._-]+/).filter(Boolean)
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase()
  }
  return trimmed.slice(0, 2).toUpperCase()
}

const PROVIDER_LABELS: Record<AuthProvider, string> = {
  google:  'Signed in with Google',
  apple:   'Signed in with Apple',
  email:   'Signed in with email magic-link',
  github:  'Signed in with GitHub',
  unknown: 'Signed in',
}

interface AvatarProps {
  user: User | null
  className?: string
}

function Avatar({ user, className = 'h-7 w-7' }: AvatarProps) {
  const url = (user?.user_metadata as { avatar_url?: string })?.avatar_url
  const provider = detectProvider(user)
  if (url) {
    return (
      <img
        src={url}
        alt=""
        className={`${className} rounded-full object-cover ring-1 ring-edge/60`}
        referrerPolicy="no-referrer"
      />
    )
  }
  // Fallback: provider-tinted disc with initials. Each provider gets a
  // distinct hue so an operator with two accounts can tell them apart at
  // a glance without reading the email below.
  const tone = AVATAR_TONE[provider]
  return (
    <span
      aria-hidden="true"
      className={`${className} inline-flex items-center justify-center rounded-full text-3xs font-semibold ring-1 ${tone}`}
    >
      {initialsFor(user)}
    </span>
  )
}

const AVATAR_TONE: Record<AuthProvider, string> = {
  google:  'bg-info-muted text-info ring-info/40',
  apple:   'bg-surface-overlay text-fg ring-edge',
  email:   'bg-brand/15 text-brand ring-brand/40',
  github:  'bg-accent-muted/70 text-accent-foreground ring-accent/40',
  unknown: 'bg-surface-overlay text-fg-muted ring-edge-subtle',
}

/**
 * Provider OAuth marks. Each is a flattened, monochrome glyph drawn
 * from the official trademark guidelines so it reads at 12 px. The
 * brand color comes from the parent `text-*` class — these glyphs
 * paint with currentColor so a single component handles light + dark
 * mode without a token duplicate.
 */
function GoogleGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" width={11} height={11} aria-hidden="true" className={className}>
      <path
        fill="currentColor"
        d="M14.4 8.16c0-.46-.04-.91-.12-1.34H8v2.54h3.6a3.07 3.07 0 0 1-1.34 2.02v1.67h2.16c1.27-1.16 2-2.88 2-4.89z"
        opacity="0.95"
      />
      <path
        fill="currentColor"
        d="M8 14.5c1.8 0 3.32-.6 4.42-1.62l-2.16-1.67c-.6.4-1.36.64-2.26.64-1.74 0-3.21-1.17-3.74-2.74H1.84v1.72A6.5 6.5 0 0 0 8 14.5z"
        opacity="0.7"
      />
      <path
        fill="currentColor"
        d="M4.26 9.1A3.9 3.9 0 0 1 4.06 8c0-.38.07-.75.2-1.1V5.18H1.84A6.5 6.5 0 0 0 1.5 8c0 1.05.25 2.04.34 2.82l2.42-1.72z"
        opacity="0.45"
      />
      <path
        fill="currentColor"
        d="M8 4.16c.98 0 1.86.34 2.55.99l1.91-1.91A6.5 6.5 0 0 0 8 1.5a6.5 6.5 0 0 0-6.16 3.68l2.42 1.72C4.79 5.33 6.26 4.16 8 4.16z"
        opacity="0.85"
      />
    </svg>
  )
}

function AppleGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" width={11} height={11} aria-hidden="true" className={className}>
      <path
        fill="currentColor"
        d="M11.4 8.4c-.02-1.62 1.32-2.4 1.38-2.44-.75-1.1-1.92-1.25-2.34-1.27-1-.1-1.95.59-2.46.59-.51 0-1.29-.58-2.13-.56-1.1.02-2.12.64-2.68 1.62-1.14 1.98-.29 4.9.83 6.5.55.79 1.2 1.66 2.05 1.63.83-.03 1.14-.53 2.14-.53s1.28.53 2.15.51c.89-.02 1.45-.8 2-1.59.63-.91.89-1.79.9-1.83-.02-.01-1.73-.66-1.74-2.63zM9.83 3.42c.46-.55.77-1.32.68-2.08-.66.03-1.46.44-1.93.99-.42.49-.79 1.27-.69 2.02.74.06 1.49-.38 1.94-.93z"
      />
    </svg>
  )
}

function EmailGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={11}
      height={11}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <rect x="2" y="3.5" width="12" height="9" rx="1.5" />
      <path d="M2.5 4.5l5.5 4 5.5-4" />
    </svg>
  )
}

function GitHubGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" width={11} height={11} aria-hidden="true" className={className}>
      <path
        fill="currentColor"
        d="M8 1.5a6.5 6.5 0 0 0-2.05 12.66c.32.06.45-.14.45-.31v-1.16c-1.81.39-2.19-.87-2.19-.87-.3-.75-.72-.95-.72-.95-.59-.4.04-.4.04-.4.66.05 1 .68 1 .68.58 1 1.52.71 1.89.55.06-.42.23-.71.41-.87-1.45-.16-2.97-.72-2.97-3.21 0-.71.25-1.29.67-1.74-.07-.17-.29-.83.06-1.74 0 0 .55-.18 1.79.66a6.2 6.2 0 0 1 3.26 0c1.24-.84 1.78-.66 1.78-.66.36.91.13 1.57.07 1.74.42.45.67 1.03.67 1.74 0 2.49-1.52 3.05-2.97 3.21.23.2.44.6.44 1.21v1.79c0 .17.13.38.45.31A6.5 6.5 0 0 0 8 1.5z"
      />
    </svg>
  )
}

const PROVIDER_GLYPH: Record<AuthProvider, ((p: { className?: string }) => ReactElement) | null> = {
  google:  GoogleGlyph,
  apple:   AppleGlyph,
  email:   EmailGlyph,
  github:  GitHubGlyph,
  unknown: null,
}

const PROVIDER_TINT: Record<AuthProvider, string> = {
  google:  'text-info',
  apple:   'text-fg',
  email:   'text-brand',
  github:  'text-accent',
  unknown: 'text-fg-faint',
}

function SignOutGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={14}
      height={14}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M9 11.5v1.5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1.5" />
      <path d="M7 8h7" />
      <path d="M11.5 5.5L14 8l-2.5 2.5" />
    </svg>
  )
}

interface SidebarUserCardProps {
  user: User | null
  signOut: () => Promise<void> | void
}

export function SidebarUserCard({ user, signOut }: SidebarUserCardProps) {
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const provider = detectProvider(user)
  const ProviderGlyph = PROVIDER_GLYPH[provider]

  const handleConfirmSignOut = async () => {
    setSigningOut(true)
    try {
      await signOut()
    } finally {
      setSigningOut(false)
      setConfirmOpen(false)
    }
  }

  return (
    <>
      <div className="rounded-sm border border-edge-subtle/60 bg-surface-raised/40 px-1.5 py-1.5 hover:border-edge/60 motion-safe:transition-colors space-y-1.5">
        <div className="group flex items-center gap-2">
          <Avatar user={user} className="h-6 w-6 shrink-0" />
          <div className="min-w-0 flex-1">
            <div
              className="truncate text-2xs font-medium text-fg-secondary"
              title={user?.email ?? 'No email'}
            >
              {user?.email ?? 'No email'}
            </div>
            {ProviderGlyph && (
              <div
                className={`mt-0.5 flex items-center gap-1 text-3xs ${PROVIDER_TINT[provider]}`}
                title={PROVIDER_LABELS[provider]}
              >
                <ProviderGlyph className="shrink-0" />
                <span className="truncate font-medium leading-none capitalize">{provider}</span>
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => setConfirmOpen(true)}
            className="shrink-0 inline-flex items-center justify-center h-6 w-6 rounded-sm text-rose hover:text-rose hover:bg-rose-muted/60 motion-safe:transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-rose/50"
            aria-label="Sign out"
            title="Sign out"
          >
            <SignOutGlyph />
          </button>
        </div>
        <PlanBadge density="sidebar" />
      </div>
      {confirmOpen && (
        <ConfirmDialog
          title="Sign out of mushi mushi?"
          body={`You'll be returned to the sign-in screen. Any unsaved drafts on this tab will be discarded.`}
          confirmLabel="Sign out"
          cancelLabel="Stay signed in"
          tone="danger"
          loading={signingOut}
          onConfirm={handleConfirmSignOut}
          onCancel={() => setConfirmOpen(false)}
        />
      )}
    </>
  )
}
