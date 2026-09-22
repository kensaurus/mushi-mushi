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
 *
 * URL parameters (the docs site appends them to signup links, see
 * apps/docs/lib/site-analytics.ts decorateSignupHref):
 *   - `src`     campaign / CTA tag            → `signup_src`
 *   - `ft_src`  first-touch utm_source        → `signup_first_touch`
 *               (falls back to `utm_source`, so a post that links straight
 *               to the console is attributed too)
 *   - `utm_medium` / `utm_campaign`           → `signup_first_touch_medium` / `_campaign`
 *   - `ref`     growth-loop referral          → `loop_ref`, only when it is a
 *               loop ref ({@link isLoopRef}). Until 2026-09-22 the docs site
 *               put the first-touch utm_source in `ref=`, which made every UTM
 *               visitor who signed up a loop signup.
 * company_funnel_weekly reads `signup_first_touch` as the source when the
 * user skipped "How did you hear about us?", and `loop_ref` for loop signups.
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

/**
 * Which product the account signed up for: the builder console or Mushi
 * Bounties (testers). Mirrors LoginPage's `?as=tester` switch. Stamped on
 * the auth user so the company funnel can count builder signups without
 * the tester marketplace inflating them.
 */
type SignupTrack = 'console' | 'tester'

export interface SignupMeta {
  /** Self-reported answer from the signup form. */
  signup_source?: SignupSource
  /** Free text shown only when `signup_source === 'other'`. */
  signup_source_detail?: string
  /** `?src=` campaign tag on the signup URL (docs CTAs, launch posts). */
  signup_src?: string
  /** `?ref=` from the widget's "Bug reports by Mushi" growth-loop mark. */
  loop_ref?: string
  /** First-touch utm_source (`?ft_src=`, else `?utm_source=`), lowercase. */
  signup_first_touch?: string
  /** First-touch utm_medium (`?utm_medium=`). */
  signup_first_touch_medium?: string
  /** First-touch utm_campaign (`?utm_campaign=`). */
  signup_first_touch_campaign?: string
  /** Console (builder) or tester signup — see {@link SignupTrack}. */
  signup_track?: SignupTrack
}

const STASH_KEY = 'mushi_signup_meta'
const TRACKED_KEY_PREFIX = 'mushi_signup_tracked:'
/** Value recorded when the user skipped the optional source question. */
const SIGNUP_SOURCE_UNSPECIFIED = 'unspecified'
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

/**
 * First-touch sources become by_source rows in the growth funnel and a
 * `?source=` filter on GET /v1/admin/growth/funnel, so they take that route's
 * shape (growth.ts SOURCE_RE), lowercased so `HN` and `hn` share a row.
 */
const FIRST_TOUCH_SOURCE_RE = /^[a-z0-9][a-z0-9_.:-]{0,63}$/

function cleanFirstTouchSource(raw: string | null | undefined): string | undefined {
  const s = raw?.trim().toLowerCase()
  return s && FIRST_TOUCH_SOURCE_RE.test(s) ? s : undefined
}

/**
 * The widget's "Bug reports by Mushi" mark links to the landing with
 * `ref=<first 12 hex chars of sha256(projectId)>` and accepts 6-64 lowercase
 * hex (packages/web/src/widget-helpers.ts buildBrandFooterHref). Only that
 * shape is a growth-loop referral; company_funnel_weekly's loop_signups uses
 * the same pattern.
 */
const LOOP_REF_RE = /^[0-9a-f]{6,64}$/

function isLoopRef(value: string | null | undefined): value is string {
  return typeof value === 'string' && LOOP_REF_RE.test(value)
}

function cleanTrack(raw: unknown): SignupTrack | undefined {
  return raw === 'console' || raw === 'tester' ? raw : undefined
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
  const firstTouch = cleanFirstTouchSource(meta.signup_first_touch)
  if (firstTouch) out.signup_first_touch = firstTouch
  const medium = cleanTag(meta.signup_first_touch_medium)
  if (medium) out.signup_first_touch_medium = medium
  const campaign = cleanTag(meta.signup_first_touch_campaign)
  if (campaign) out.signup_first_touch_campaign = campaign
  const track = cleanTrack(meta.signup_track)
  if (track) out.signup_track = track
  return out
}

type UrlSignupMeta = Pick<
  SignupMeta,
  | 'signup_src'
  | 'loop_ref'
  | 'signup_first_touch'
  | 'signup_first_touch_medium'
  | 'signup_first_touch_campaign'
  | 'signup_track'
>

/**
 * Read the login/signup URL's attribution (see the file header for each
 * parameter), plus the signup track from `?as=` (the same `as=tester` rule
 * LoginPage uses to pick its tester track; anything else is the console).
 * A `?ref=` that is not a loop ref is ignored.
 */
export function readSignupMetaFromSearch(params: URLSearchParams): UrlSignupMeta {
  const ref = params.get('ref')?.trim()
  return compactSignupMeta({
    signup_src: params.get('src') ?? undefined,
    loop_ref: isLoopRef(ref) ? ref : undefined,
    signup_first_touch: params.get('ft_src') ?? params.get('utm_source') ?? undefined,
    signup_first_touch_medium: params.get('utm_medium') ?? undefined,
    signup_first_touch_campaign: params.get('utm_campaign') ?? undefined,
    signup_track: params.get('as') === 'tester' ? 'tester' : 'console',
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

/** @internal Exported for unit tests only. */
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

/** @internal Exported for unit tests only. */
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
    signup_first_touch: typeof m.signup_first_touch === 'string' ? m.signup_first_touch : undefined,
    signup_first_touch_medium:
      typeof m.signup_first_touch_medium === 'string' ? m.signup_first_touch_medium : undefined,
    signup_first_touch_campaign:
      typeof m.signup_first_touch_campaign === 'string' ? m.signup_first_touch_campaign : undefined,
    // The tester magic-link path (auth.tsx signInAsTester) predates the
    // track stamp and marks testers with `signup_intent: 'tester'` instead.
    signup_track: cleanTrack(m.signup_track) ?? (m.signup_intent === 'tester' ? 'tester' : undefined),
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
    trackSelf('signup_completed', {
      signup_source: meta.signup_source ?? SIGNUP_SOURCE_UNSPECIFIED,
      ...(meta.signup_source_detail ? { signup_source_detail: meta.signup_source_detail } : {}),
      ...(meta.signup_src ? { signup_src: meta.signup_src } : {}),
      ...(meta.signup_track ? { signup_track: meta.signup_track } : {}),
      ...(meta.signup_first_touch ? { signup_first_touch: meta.signup_first_touch } : {}),
      ...(meta.signup_first_touch_medium ? { signup_first_touch_medium: meta.signup_first_touch_medium } : {}),
      ...(meta.signup_first_touch_campaign
        ? { signup_first_touch_campaign: meta.signup_first_touch_campaign }
        : {}),
    })
    // Accounts attributed before 2026-09-22 can carry ref=<utm_source> as
    // loop_ref; only a real loop ref is a loop signup.
    if (isLoopRef(meta.loop_ref)) trackSelf('loop_signup', { ref: meta.loop_ref })
  } catch {
    /* attribution is best-effort; never break the auth flow */
  }
}
