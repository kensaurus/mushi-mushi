/**
 * FILE: apps/admin/src/components/SidebarUserCard.tsx
 * PURPOSE: Bottom of the sidebar — identity + account switcher + sign-out.
 *
 *          The card shows the active account (avatar, email, provider chip,
 *          plan badge) and, on click, opens a YouTube-Studio-style switcher:
 *
 *            ┌────────────────────────────┐
 *            │ ✓ me@acme.com      Google  │  ← active
 *            │   me@side.dev      GitHub  │  ← click to switch (no re-auth)
 *            │   old@x.com    ⚠ Re-auth   │
 *            ├────────────────────────────┤
 *            │ + Add Google account       │
 *            │ + Add GitHub account       │
 *            ├────────────────────────────┤
 *            │ Sign out of all accounts   │
 *            └────────────────────────────┘
 *
 *          Multiple accounts stay signed in at once (their sessions are
 *          persisted by accountSessions.ts); switching swaps the live Supabase
 *          session via setSession() and reloads into /dashboard. The rose
 *          sign-out icon remains as a fast "sign out of everything".
 *
 *          Identity derivation (provider / initials / avatar) is shared with
 *          the session store via lib/authIdentity.ts so both render the same.
 */

import { useEffect, useRef, useState, type ReactElement } from 'react'
import type { User } from '@supabase/supabase-js'
import { ConfirmDialog } from './ConfirmDialog'
import { PlanBadge } from './PlanBadge'
import { CHIP_TONE } from '../lib/chipTone'
import { useAuth } from '../lib/auth'
import {
  detectProvider,
  initialsFor,
  initialsFromName,
  type AuthProvider,
} from '../lib/authIdentity'
import {
  useAccounts,
  addAccount,
  switchToAccount,
  removeAccount,
  clearAllAccounts,
  type StoredAccount,
} from '../lib/accountSessions'

const PROVIDER_LABELS: Record<AuthProvider, string> = {
  google:  'Signed in with Google',
  apple:   'Signed in with Apple',
  email:   'Signed in with email magic-link',
  github:  'Signed in with GitHub',
  unknown: 'Signed in',
}

const AVATAR_TONE: Record<AuthProvider, string> = {
  google:  CHIP_TONE.infoSubtle + ' ring-info/40',
  apple:   'bg-surface-overlay text-fg ring-edge',
  email:   CHIP_TONE.brandSubtle + ' ring-brand/40',
  github:  CHIP_TONE.accentSubtle + ' ring-brand/40',
  unknown: 'bg-surface-overlay text-fg-muted ring-edge-subtle',
}

interface AvatarProps {
  avatarUrl: string | null
  provider: AuthProvider
  initials: string
  className?: string
}

function Avatar({ avatarUrl, provider, initials, className = 'h-7 w-7' }: AvatarProps) {
  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt=""
        className={`${className} shrink-0 rounded-full object-cover ring-1 ring-edge/60`}
        referrerPolicy="no-referrer"
      />
    )
  }
  // Fallback: provider-tinted disc with initials. Each provider gets a distinct
  // hue so an operator with two accounts can tell them apart at a glance.
  return (
    <span
      aria-hidden="true"
      className={`${className} inline-flex shrink-0 items-center justify-center rounded-full text-3xs font-semibold ring-1 ${AVATAR_TONE[provider]}`}
    >
      {initials}
    </span>
  )
}

/* ── Provider glyphs (monochrome, currentColor) ─────────────────────────── */

function GoogleGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" width={11} height={11} aria-hidden="true" className={className}>
      <path fill="currentColor" opacity="0.95" d="M14.4 8.16c0-.46-.04-.91-.12-1.34H8v2.54h3.6a3.07 3.07 0 0 1-1.34 2.02v1.67h2.16c1.27-1.16 2-2.88 2-4.89z" />
      <path fill="currentColor" opacity="0.7" d="M8 14.5c1.8 0 3.32-.6 4.42-1.62l-2.16-1.67c-.6.4-1.36.64-2.26.64-1.74 0-3.21-1.17-3.74-2.74H1.84v1.72A6.5 6.5 0 0 0 8 14.5z" />
      <path fill="currentColor" opacity="0.45" d="M4.26 9.1A3.9 3.9 0 0 1 4.06 8c0-.38.07-.75.2-1.1V5.18H1.84A6.5 6.5 0 0 0 1.5 8c0 1.05.25 2.04.34 2.82l2.42-1.72z" />
      <path fill="currentColor" opacity="0.85" d="M8 4.16c.98 0 1.86.34 2.55.99l1.91-1.91A6.5 6.5 0 0 0 8 1.5a6.5 6.5 0 0 0-6.16 3.68l2.42 1.72C4.79 5.33 6.26 4.16 8 4.16z" />
    </svg>
  )
}

function AppleGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" width={11} height={11} aria-hidden="true" className={className}>
      <path fill="currentColor" d="M11.4 8.4c-.02-1.62 1.32-2.4 1.38-2.44-.75-1.1-1.92-1.25-2.34-1.27-1-.1-1.95.59-2.46.59-.51 0-1.29-.58-2.13-.56-1.1.02-2.12.64-2.68 1.62-1.14 1.98-.29 4.9.83 6.5.55.79 1.2 1.66 2.05 1.63.83-.03 1.14-.53 2.14-.53s1.28.53 2.15.51c.89-.02 1.45-.8 2-1.59.63-.91.89-1.79.9-1.83-.02-.01-1.73-.66-1.74-2.63zM9.83 3.42c.46-.55.77-1.32.68-2.08-.66.03-1.46.44-1.93.99-.42.49-.79 1.27-.69 2.02.74.06 1.49-.38 1.94-.93z" />
    </svg>
  )
}

function EmailGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" width={11} height={11} fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      <rect x="2" y="3.5" width="12" height="9" rx="1.5" />
      <path d="M2.5 4.5l5.5 4 5.5-4" />
    </svg>
  )
}

function GitHubGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" width={11} height={11} aria-hidden="true" className={className}>
      <path fill="currentColor" d="M8 1.5a6.5 6.5 0 0 0-2.05 12.66c.32.06.45-.14.45-.31v-1.16c-1.81.39-2.19-.87-2.19-.87-.3-.75-.72-.95-.72-.95-.59-.4.04-.4.04-.4.66.05 1 .68 1 .68.58 1 1.52.71 1.89.55.06-.42.23-.71.41-.87-1.45-.16-2.97-.72-2.97-3.21 0-.71.25-1.29.67-1.74-.07-.17-.29-.83.06-1.74 0 0 .55-.18 1.79.66a6.2 6.2 0 0 1 3.26 0c1.24-.84 1.78-.66 1.78-.66.36.91.13 1.57.07 1.74.42.45.67 1.03.67 1.74 0 2.49-1.52 3.05-2.97 3.21.23.2.44.6.44 1.21v1.79c0 .17.13.38.45.31A6.5 6.5 0 0 0 8 1.5z" />
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
  google:  'text-info-foreground',
  apple:   'text-fg',
  email:   'text-brand',
  github:  'text-accent-foreground',
  unknown: 'text-fg-faint',
}

function SignOutGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" width={14} height={14} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      <path d="M9 11.5v1.5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1.5" />
      <path d="M7 8h7" />
      <path d="M11.5 5.5L14 8l-2.5 2.5" />
    </svg>
  )
}

function ChevronGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" width={12} height={12} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      <path d="M4 10l4-4 4 4" />
    </svg>
  )
}

function ProviderChip({ provider }: { provider: AuthProvider }) {
  const Glyph = PROVIDER_GLYPH[provider]
  if (!Glyph) return null
  return (
    <span
      className={`flex items-center gap-1 text-2xs ${PROVIDER_TINT[provider]}`}
      title={PROVIDER_LABELS[provider]}
    >
      <Glyph className="shrink-0" />
      <span className="truncate font-medium capitalize leading-none">{provider}</span>
    </span>
  )
}

interface AccountRowProps {
  account: StoredAccount
  isActive: boolean
  busy: boolean
  onSwitch: () => void
  onRemove: () => void
}

function AccountRow({ account, isActive, busy, onSwitch, onRemove }: AccountRowProps) {
  const label = account.displayName ?? account.email ?? account.userId
  return (
    <div
      className={`group flex items-center gap-2 rounded-md px-2 py-1.5 ${
        isActive ? 'bg-surface-overlay/50' : 'hover:bg-surface-overlay/40'
      }`}
    >
      <button
        type="button"
        role="menuitemradio"
        aria-checked={isActive}
        disabled={busy || isActive}
        onClick={onSwitch}
        className="flex min-w-0 flex-1 items-center gap-2 text-left focus-visible:outline-none disabled:cursor-default"
        title={isActive ? 'Current account' : `Switch to ${account.email ?? label}`}
      >
        <Avatar
          avatarUrl={account.avatarUrl}
          provider={account.provider}
          initials={initialsFromName(account.displayName ?? account.email)}
          className="h-6 w-6"
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-2xs font-medium text-fg-secondary">
            {account.email ?? label}
          </span>
          <span className="mt-0.5 flex items-center gap-1.5">
            <ProviderChip provider={account.provider} />
            {account.needsReauth && (
              <span className="text-2xs font-medium text-warning-foreground">⚠ Re-auth</span>
            )}
          </span>
        </span>
        {isActive && <span className="shrink-0 text-2xs font-semibold text-brand">✓</span>}
      </button>
      {!isActive && (
        <button
          type="button"
          onClick={onRemove}
          disabled={busy}
          aria-label={`Remove ${account.email ?? label}`}
          title="Remove from this device"
          className="shrink-0 rounded-sm p-0.5 text-fg-faint opacity-0 hover:text-fg-secondary focus-visible:opacity-100 focus-visible:outline-none group-hover:opacity-100"
        >
          <svg viewBox="0 0 16 16" width={12} height={12} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" aria-hidden="true">
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      )}
    </div>
  )
}

interface SidebarUserCardProps {
  user: User | null
  signOut: () => Promise<void> | void
}

export function SidebarUserCard({ user, signOut }: SidebarUserCardProps) {
  const { signInWithGoogle, signInWithGitHub } = useAuth()
  const { accounts, activeUserId } = useAccounts()
  const [open, setOpen] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const [busyUserId, setBusyUserId] = useState<string | null>(null)
  const [addingBusy, setAddingBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)

  const provider = detectProvider(user)

  // Close the switcher on outside click / Escape.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const handleSwitch = async (userId: string) => {
    setError(null)
    setBusyUserId(userId)
    // switchToAccount hard-navigates on success, so a lingering busy state only
    // matters on failure.
    const result = await switchToAccount(userId)
    setBusyUserId(null)
    if (result.error) setError(result.error)
  }

  const handleAdd = async (signIn: () => Promise<{ error?: string }>) => {
    setError(null)
    setAddingBusy(true)
    const result = await addAccount(signIn)
    // On success the browser redirects to the OAuth provider; an error means it
    // never left, so surface it and clear the busy flag.
    if (result.error) {
      setError(result.error)
      setAddingBusy(false)
    }
  }

  const handleRemove = (userId: string) => {
    setError(null)
    removeAccount(userId)
  }

  const handleConfirmSignOut = async () => {
    setSigningOut(true)
    try {
      clearAllAccounts()
      await signOut()
    } finally {
      setSigningOut(false)
      setConfirmOpen(false)
    }
  }

  const busy = busyUserId !== null || addingBusy

  return (
    <>
      <div ref={containerRef} className="relative space-y-1 pt-0.5">
        {open && (
          <div
            role="menu"
            aria-label="Switch account"
            className="absolute bottom-full left-0 right-0 z-50 mb-1.5 rounded-md border border-edge-subtle bg-surface-raised p-1 shadow-raised"
          >
            <div className="max-h-64 overflow-y-auto">
              {accounts.map((a) => (
                <AccountRow
                  key={a.userId}
                  account={a}
                  isActive={a.userId === activeUserId}
                  busy={busy}
                  onSwitch={() => void handleSwitch(a.userId)}
                  onRemove={() => handleRemove(a.userId)}
                />
              ))}
            </div>
            <div className="my-1 border-t border-edge-subtle" />
            <button
              type="button"
              role="menuitem"
              disabled={busy}
              onClick={() => void handleAdd(signInWithGoogle)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-2xs font-medium text-fg-secondary hover:bg-surface-overlay/40 focus-visible:outline-none disabled:opacity-60"
            >
              <span className="inline-flex h-6 w-6 items-center justify-center text-info-foreground"><GoogleGlyph /></span>
              Add Google account
            </button>
            <button
              type="button"
              role="menuitem"
              disabled={busy}
              onClick={() => void handleAdd(signInWithGitHub)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-2xs font-medium text-fg-secondary hover:bg-surface-overlay/40 focus-visible:outline-none disabled:opacity-60"
            >
              <span className="inline-flex h-6 w-6 items-center justify-center text-accent-foreground"><GitHubGlyph /></span>
              Add GitHub account
            </button>
            <div className="my-1 border-t border-edge-subtle" />
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false)
                setConfirmOpen(true)
              }}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-2xs font-medium text-rose hover:bg-rose-muted/50 focus-visible:outline-none"
            >
              <span className="inline-flex h-6 w-6 items-center justify-center"><SignOutGlyph /></span>
              Sign out of all accounts
            </button>
            {error && (
              <div className="px-2 py-1 text-2xs text-danger-foreground" role="alert">
                {error}
              </div>
            )}
          </div>
        )}

        <div className="group flex items-center gap-2">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={open}
            className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-0.5 text-left hover:bg-surface-overlay/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-edge"
            title="Switch account"
          >
            <Avatar
              avatarUrl={(user?.user_metadata as { avatar_url?: string })?.avatar_url ?? null}
              provider={provider}
              initials={initialsFor(user)}
              className="h-6 w-6"
            />
            <span className="min-w-0 flex-1">
              <span
                className="block truncate text-2xs font-medium text-fg-secondary"
                title={user?.email ?? 'No email'}
              >
                {user?.email ?? 'No email'}
              </span>
              <span className="mt-0.5 block"><ProviderChip provider={provider} /></span>
            </span>
            <ChevronGlyph
              className={`shrink-0 text-fg-faint motion-safe:transition-transform ${open ? '' : 'rotate-180'}`}
            />
          </button>
          <button
            type="button"
            onClick={() => setConfirmOpen(true)}
            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-sm text-rose hover:bg-rose-muted/60 hover:text-rose motion-safe:transition-opacity focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-rose/50"
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
          body="This signs out of every account on this device and returns you to the sign-in screen. Any unsaved drafts on this tab will be discarded."
          confirmLabel="Sign out of all"
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
