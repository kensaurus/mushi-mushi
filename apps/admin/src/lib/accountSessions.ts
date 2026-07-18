/**
 * FILE: apps/admin/src/lib/accountSessions.ts
 * PURPOSE: Persisted multi-account session store — the data + actions behind the
 *          YouTube-Studio-style "Switch account" affordance in the sidebar.
 *
 *          The admin console runs a single Supabase client with the default
 *          localStorage-persisted session, so it can only hold ONE live session
 *          at a time. To let an operator keep several accounts "signed in" and
 *          flip between them without re-entering credentials, we persist each
 *          account's Supabase session (access + refresh token) here, keyed by
 *          user id, and swap the active one via `supabase.auth.setSession()`.
 *
 *          Storage model (localStorage key `mushi:accounts`):
 *            { accounts: StoredAccount[]; activeUserId: string | null }
 *
 *          Reactivity mirrors activeOrg.ts: a custom window event + `storage`
 *          event drive `useSyncExternalStore`, so the sidebar and any other tab
 *          re-render on add / switch / remove.
 *
 *          SECURITY NOTE: this deliberately stores refresh tokens in
 *          localStorage. That is already the admin console's posture — the
 *          Supabase client persists the *active* session in localStorage too
 *          (`persistSession: true`), so multi-account storage widens the blast
 *          radius from one token to N, but does not introduce a new class of
 *          exposure. (The SBC console, which keeps tokens out of JS behind an
 *          httpOnly cookie, uses a different, backend-managed design — see the
 *          plan; do NOT copy this file's approach there.)
 */

import type { Session } from '@supabase/supabase-js'
import { supabase, invalidateApiCache } from './supabase'
import { clearActiveOrg } from './activeOrg'
import { clearActiveProject } from './activeProject'
import { notifyAccountSwitched } from './authBroadcast'
import {
  detectProvider,
  displayNameFor,
  avatarUrlFor,
  type AuthProvider,
} from './authIdentity'
import { useSyncExternalStore } from 'react'

export const ACCOUNTS_STORAGE_KEY = 'mushi:accounts'
const ACCOUNTS_EVENT = 'mushi:accounts-change'

export interface StoredAccount {
  userId: string
  email: string | null
  displayName: string | null
  avatarUrl: string | null
  provider: AuthProvider
  session: {
    access_token: string
    refresh_token: string
    expires_at: number
  }
  /** Set when a background refresh token is rejected — the account needs a
   *  fresh sign-in before it can become active again. */
  needsReauth?: boolean
}

export interface AccountsState {
  accounts: StoredAccount[]
  activeUserId: string | null
}

const EMPTY_STATE: AccountsState = { accounts: [], activeUserId: null }

// ─── Storage plumbing ───────────────────────────────────────────────────────

function readState(): AccountsState {
  if (typeof window === 'undefined') return EMPTY_STATE
  try {
    const raw = window.localStorage.getItem(ACCOUNTS_STORAGE_KEY)
    if (!raw) return EMPTY_STATE
    const parsed = JSON.parse(raw) as Partial<AccountsState>
    if (!parsed || !Array.isArray(parsed.accounts)) return EMPTY_STATE
    // Defensive: drop any malformed rows so one corrupt entry can't break the
    // whole switcher.
    const accounts = parsed.accounts.filter(
      (a): a is StoredAccount =>
        !!a &&
        typeof a.userId === 'string' &&
        !!a.session &&
        typeof a.session.access_token === 'string' &&
        typeof a.session.refresh_token === 'string',
    )
    const activeUserId =
      typeof parsed.activeUserId === 'string' &&
      accounts.some((a) => a.userId === parsed.activeUserId)
        ? parsed.activeUserId
        : (accounts[0]?.userId ?? null)
    return { accounts, activeUserId }
  } catch {
    return EMPTY_STATE
  }
}

// Cache the parsed snapshot so useSyncExternalStore gets a stable reference
// between mutations (a fresh object every read would loop React forever).
let cachedSnapshot: AccountsState = EMPTY_STATE
let cachePrimed = false

function refreshSnapshot(): void {
  cachedSnapshot = readState()
  cachePrimed = true
}

function writeState(next: AccountsState): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(ACCOUNTS_STORAGE_KEY, JSON.stringify(next))
  } catch {
    // Storage-disabled environments simply lose multi-account persistence;
    // the single active Supabase session still works.
  }
  refreshSnapshot()
  window.dispatchEvent(new CustomEvent(ACCOUNTS_EVENT))
}

export function getAccountsSnapshot(): AccountsState {
  if (!cachePrimed) refreshSnapshot()
  return cachedSnapshot
}

export function subscribeAccounts(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const onLocal = () => listener()
  const onStorage = (event: StorageEvent) => {
    if (event.key === ACCOUNTS_STORAGE_KEY) {
      refreshSnapshot()
      listener()
    }
  }
  window.addEventListener(ACCOUNTS_EVENT, onLocal)
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener(ACCOUNTS_EVENT, onLocal)
    window.removeEventListener('storage', onStorage)
  }
}

export function useAccounts(): AccountsState {
  return useSyncExternalStore(subscribeAccounts, getAccountsSnapshot, () => EMPTY_STATE)
}

// ─── Derivation ─────────────────────────────────────────────────────────────

function accountFromSession(session: Session): StoredAccount | null {
  const user = session.user
  if (!user?.id || !session.access_token || !session.refresh_token) return null
  return {
    userId: user.id,
    email: user.email ?? null,
    displayName: displayNameFor(user),
    avatarUrl: avatarUrlFor(user),
    provider: detectProvider(user),
    session: {
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      expires_at: session.expires_at ?? 0,
    },
  }
}

// ─── Mutations ──────────────────────────────────────────────────────────────

/**
 * Record (or refresh) an account from a live Supabase session. Called from the
 * auth listener on INITIAL_SESSION / SIGNED_IN / TOKEN_REFRESHED so the active
 * account's stored tokens never go stale, and a freshly-added account is
 * captured. `activate` marks it the current account (true for real sign-ins,
 * false for a pure token refresh where the active account shouldn't change).
 */
export function upsertAccount(session: Session, activate: boolean): void {
  const account = accountFromSession(session)
  if (!account) return
  const state = getAccountsSnapshot()
  const others = state.accounts.filter((a) => a.userId !== account.userId)
  const accounts = [...others, account]
  const activeUserId = activate ? account.userId : (state.activeUserId ?? account.userId)
  writeState({ accounts, activeUserId })
}

export function markNeedsReauth(userId: string, needsReauth: boolean): void {
  const state = getAccountsSnapshot()
  const accounts = state.accounts.map((a) =>
    a.userId === userId ? { ...a, needsReauth } : a,
  )
  writeState({ ...state, accounts })
}

/**
 * Drop one account from the store. Does NOT sign it out of Supabase server-side
 * (that would require it to be the active session); it simply forgets the
 * stored tokens so the account no longer appears in the switcher.
 */
export function removeAccount(userId: string): void {
  const state = getAccountsSnapshot()
  const accounts = state.accounts.filter((a) => a.userId !== userId)
  const activeUserId =
    state.activeUserId === userId ? (accounts[0]?.userId ?? null) : state.activeUserId
  writeState({ accounts, activeUserId })
}

/** Forget every stored account (used by "Sign out of all"). */
export function clearAllAccounts(): void {
  writeState(EMPTY_STATE)
}

/**
 * Switch the live session to a stored account with NO credential re-entry.
 * `setSession` refreshes silently if the stored access token is stale; if the
 * refresh token itself is dead (rotated/expired), we flag the account for
 * re-auth and abort rather than leaving the app in a half-switched state.
 *
 * On success we reset tenant context (org/project belong to the previous
 * account) and hard-navigate to /dashboard — a clean reload is the simplest
 * guarantee that no in-memory data from the previous account bleeds through,
 * and it lets ProjectSwitcher/OrgSwitcher re-resolve the new account's default
 * org + project.
 */
export async function switchToAccount(userId: string): Promise<{ error?: string }> {
  const state = getAccountsSnapshot()
  const account = state.accounts.find((a) => a.userId === userId)
  if (!account) return { error: 'Account not found' }
  if (userId === state.activeUserId) return {}

  const { data, error } = await supabase.auth.setSession({
    access_token: account.session.access_token,
    refresh_token: account.session.refresh_token,
  })
  if (error || !data.session) {
    markNeedsReauth(userId, true)
    return { error: error?.message ?? 'Session expired — please sign in again.' }
  }

  // setSession fires onAuthStateChange (SIGNED_IN/TOKEN_REFRESHED) → upsert
  // keeps the token fresh; make the activation explicit here too.
  upsertAccount(data.session, true)
  markNeedsReauth(userId, false)

  clearActiveOrg()
  clearActiveProject()
  invalidateApiCache()
  notifyAccountSwitched()

  if (typeof window !== 'undefined') {
    window.location.assign('/dashboard')
  }
  return {}
}

/**
 * Begin adding another account. Snapshots the current live session first (so it
 * isn't lost when Supabase overwrites its single stored session with the new
 * one), then runs the provided sign-in flow — e.g. Google OAuth with
 * `prompt: select_account`. On return, the auth listener upserts + activates
 * the new account.
 */
export async function addAccount(
  signIn: () => Promise<{ error?: string }>,
): Promise<{ error?: string }> {
  const { data } = await supabase.auth.getSession()
  if (data.session) upsertAccount(data.session, false)
  return signIn()
}
