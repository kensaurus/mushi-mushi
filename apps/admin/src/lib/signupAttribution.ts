/**
 * FILE: apps/admin/src/lib/signupAttribution.ts
 * PURPOSE: Capture *where a signup came from* and persist it on the auth
 *          user so the operator growth funnel (/growth) can split by source.
 *
 * Two persistence paths, one shape (`SignupMeta`):
 *   - Email/password: `signUp(email, password, meta)` forwards it as
 *     `options.data` → lands in `auth.users.raw_user_meta_data`.
 *   - OAuth (GitHub / Google): the browser leaves the app before we have a
 *     user, so the LoginPage stashes the meta in sessionStorage; the
 *     AuthProvider's first-session effect replays it via
 *     `supabase.auth.updateUser({ data })` once, then clears the stash.
 *
 * `completeSignupAttribution` also emits the console funnel events
 * (`signup_completed`, `loop_signup`) exactly once per user per device.
 */

import type { User } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { trackSelf } from './track'

/** Answer options for "How did you hear about us?" — values are the analytics keys. */
export const SIGNUP_SOURCE_OPTIONS: ReadonlyArray<{ value: SignupSource; label: string }> = [
  { value: 'cursor_directory', label: 'Cursor / cursor.directory' },
  { value: 'claude_code', label: 'Claude Code community' },
  { value: 'github', label: 'GitHub' },
  { value: 'hn', label: 'Hacker News' },
  { value: 'reddit', label: 'Reddit' },
  { value: 'x_bluesky', label: 'X / Bluesky' },
  { value: 'friend', label: 'A friend or colleague' },
  { value: 'search', label: 'Search' },
  { value: 'other', label: 'Other' },
]

export type SignupSource =
  | 'cursor_directory'
  | 'claude_code'
  | 'github'
  | 'hn'
  | 'reddit'
  | 'x_bluesky'
  | 'friend'
  | 'search'
  | 'other'

export interface SignupMeta {
  /** Self-reported answer from the signup form. */
  signup_source?: SignupSource
  /** Free text shown only when `signup_source === 'other'`. */
  signup_source_detail?: string
  /** `?src=` campaign tag on the signup URL (docs CTAs, launch posts). */
  signup_src?: string
  /** `?ref=` from the widget's "Bug reports by Mushi" growth-loop mark. */
  loop_ref?: string
}

const STASH_KEY = 'mushi_signup_meta'
const TRACKED_KEY_PREFIX = 'mushi_signup_tracked:'
/** Value recorded when the user skipped the optional source question. */
export const SIGNUP_SOURCE_UNSPECIFIED = 'unspecified'
/** OAuth round-trips take seconds; anything older is an existing account. */
const OAUTH_FRESH_WINDOW_MS = 15 * 60 * 1000
/** Email confirmation can lag the signup form by a while — be generous. */
const EMAIL_FRESH_WINDOW_MS = 24 * 60 * 60 * 1000
const MAX_DETAIL_LENGTH = 120
const MAX_TAG_LENGTH = 64

function cleanTag(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined
  const s = raw.trim().slice(0, MAX_TAG_LENGTH)
  // Campaign tags are opaque slugs; drop anything that looks like markup/URLs.
  if (!s || !/^[A-Za-z0-9._:\-/]+$/.test(s)) return undefined
  return s
}

/** Drop empty keys so the auth metadata only carries what the user gave us. */
export function compactSignupMeta(meta: SignupMeta): SignupMeta {
  const out: SignupMeta = {}
  if (meta.signup_source) out.signup_source = meta.signup_source
  const detail = meta.signup_source_detail?.trim().slice(0, MAX_DETAIL_LENGTH)
  if (detail && out.signup_source === 'other') out.signup_source_detail = detail
  const src = cleanTag(meta.signup_src)
  if (src) out.signup_src = src
  const ref = cleanTag(meta.loop_ref)
  if (ref) out.loop_ref = ref
  return out
}

/** Read `?src=` / `?ref=` attribution from the login/signup URL. */
export function readSignupMetaFromSearch(params: URLSearchParams): Pick<SignupMeta, 'signup_src' | 'loop_ref'> {
  return compactSignupMeta({
    signup_src: params.get('src') ?? undefined,
    loop_ref: params.get('ref') ?? undefined,
  })
}

export function stashSignupMeta(meta: SignupMeta): void {
  try {
    const compact = compactSignupMeta(meta)
    if (Object.keys(compact).length === 0) {
      sessionStorage.removeItem(STASH_KEY)
      return
    }
    sessionStorage.setItem(STASH_KEY, JSON.stringify(compact))
  } catch {
    /* private mode / blocked storage — attribution is best-effort */
  }
}

export function readStashedSignupMeta(): SignupMeta | null {
  try {
    const raw = sessionStorage.getItem(STASH_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    const compact = compactSignupMeta(parsed as SignupMeta)
    return Object.keys(compact).length > 0 ? compact : null
  } catch {
    return null
  }
}

export function clearStashedSignupMeta(): void {
  try {
    sessionStorage.removeItem(STASH_KEY)
  } catch {
    /* ignore */
  }
}

function ageMs(user: User): number {
  const created = Date.parse(user.created_at ?? '')
  return Number.isFinite(created) ? Date.now() - created : Number.POSITIVE_INFINITY
}

function hasTracked(userId: string): boolean {
  try {
    return localStorage.getItem(TRACKED_KEY_PREFIX + userId) === '1'
  } catch {
    return false
  }
}

function markTracked(userId: string): void {
  try {
    localStorage.setItem(TRACKED_KEY_PREFIX + userId, '1')
  } catch {
    /* ignore */
  }
}

function metaFromUser(user: User): SignupMeta {
  const m = (user.user_metadata ?? {}) as Record<string, unknown>
  return compactSignupMeta({
    signup_source: typeof m.signup_source === 'string' ? (m.signup_source as SignupSource) : undefined,
    signup_source_detail: typeof m.signup_source_detail === 'string' ? m.signup_source_detail : undefined,
    signup_src: typeof m.signup_src === 'string' ? m.signup_src : undefined,
    loop_ref: typeof m.loop_ref === 'string' ? m.loop_ref : undefined,
  })
}

/**
 * Run once per session user. Replays a stashed OAuth signup meta onto the
 * user (only for accounts created moments ago, so an existing account that
 * signs in with OAuth on a tab carrying a stash is never re-attributed) and
 * emits `signup_completed` / `loop_signup` once per user per device.
 */
export async function completeSignupAttribution(user: User): Promise<void> {
  try {
    if (hasTracked(user.id)) {
      clearStashedSignupMeta()
      return
    }
    let meta = metaFromUser(user)
    const stash = readStashedSignupMeta()
    const age = ageMs(user)

    if (stash) {
      if (!meta.signup_source && age <= OAUTH_FRESH_WINDOW_MS) {
        const merged = compactSignupMeta({ ...stash, ...meta })
        const { error } = await supabase.auth.updateUser({ data: merged })
        if (!error) meta = merged
      }
      // Stale (existing account) or replayed — either way it's done.
      clearStashedSignupMeta()
    }

    // Only accounts created recently count as a signup on this device. The
    // email path stamps `signup_source` at signUp() time, so its presence plus
    // a young `created_at` is the "first session after confirm" signal.
    const isFreshSignup = meta.signup_source
      ? age <= EMAIL_FRESH_WINDOW_MS
      : age <= OAUTH_FRESH_WINDOW_MS
    if (!isFreshSignup) return

    markTracked(user.id)
    const props: Record<string, string> = {
      signup_source: meta.signup_source ?? SIGNUP_SOURCE_UNSPECIFIED,
    }
    if (meta.signup_source_detail) props.signup_source_detail = meta.signup_source_detail
    if (meta.signup_src) props.signup_src = meta.signup_src
    trackSelf('signup_completed', props)
    if (meta.loop_ref) trackSelf('loop_signup', { ref: meta.loop_ref })
  } catch {
    /* attribution is best-effort; never break the auth flow */
  }
}
