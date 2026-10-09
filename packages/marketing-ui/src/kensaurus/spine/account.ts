/**
 * KENSAURUS spine — account types and canonical app ids.
 *
 * SOURCE: kensaurus/yen-yen kensaurus-spine/account.ts. Vendored copies are
 * written by scripts/spine-sync.mjs and verified by check-spine.mjs — do not
 * edit a copy; change the source and re-sync.
 *
 * `KensaurusMe` is the JSON returned by `kensaurus_me()` / `kensaurus_me_for()`
 * (migration 20260919142000) verbatim — snake_case keys, every key always
 * present. The hub, every app's KENSAURUS card and glot's bridge read it.
 */

import {
  KENSAURUS_APP_ALIASES,
  KENSAURUS_APP_IDS,
  KENSAURUS_APPS,
  type KensaurusApp,
  type KensaurusAppId,
} from './apps.generated'

export { KENSAURUS_APP_ALIASES, KENSAURUS_APP_IDS }
export type { KensaurusAppId }

export function isKensaurusAppId(value: string): value is KensaurusAppId {
  return (KENSAURUS_APP_IDS as readonly string[]).includes(value)
}

/**
 * Canonical manifest id for an id or alias (`glot` → `glot-it`). Unknown
 * values pass through unchanged, mirroring `kensaurus_canonical_app()` in
 * the database and the ingest function.
 */
export function canonicalAppId(idOrAlias: string): string {
  const canonical = Object.prototype.hasOwnProperty.call(KENSAURUS_APP_ALIASES, idOrAlias)
    ? KENSAURUS_APP_ALIASES[idOrAlias]
    : undefined
  return canonical ?? idOrAlias
}

// ── Passport ─────────────────────────────────────────────────────────────────

/**
 * The apps a passport can be stamped for: the manifest entries with an
 * activation event, in manifest order. Mirrors `kensaurus_config.passport_apps`
 * (spine.test.mjs asserts the two agree).
 */
export const KENSAURUS_PASSPORT_APP_IDS: readonly KensaurusAppId[] = (
  KENSAURUS_APPS as readonly KensaurusApp[]
)
  .filter((app) => app.activationEvent !== undefined)
  .map((app) => app.id as KensaurusAppId)

/** True for a canonical id of a passport app (aliases are not accepted). */
export function isKensaurusPassportApp(value: string): value is KensaurusAppId {
  return (KENSAURUS_PASSPORT_APP_IDS as readonly string[]).includes(value)
}

/**
 * Result of `kensaurus_stamp_grant` — what `kensaurus-stamp` (kenji apps) and
 * the bridge action `stamp` (glot) return. `account_required` means the app
 * should show its save-progress / sign-in surface once and call again.
 */
export type KensaurusStampReason = 'account_required' | 'not_activated' | 'unknown_app'

export type KensaurusStampGrant =
  | {
      readonly ok: true
      /** The stamp was already earned; nothing new was granted. */
      readonly already: boolean
      readonly app: KensaurusAppId
      /** Wallet credit granted for this stamp, sell-value micro-USD (0 while pending). */
      readonly credits_micro: number
      /** Earned while the daily grant budget was exhausted; credited later. */
      readonly credit_pending: boolean
      /** Stamps this account holds after the call. */
      readonly stamps: number
    }
  | { readonly ok: false; readonly reason: KensaurusStampReason }

// ── kensaurus_me() ───────────────────────────────────────────────────────────

export interface KensaurusMeProfile {
  readonly user_id: string
  readonly display_name: string | null
  readonly avatar_url: string | null
  readonly marketing_consent: boolean
  /** The first passport app the person opened; null until they touch one. */
  readonly home_app: KensaurusAppId | null
  /** Supabase anonymous sign-in; such an account cannot hold a stamp. */
  readonly is_anonymous: boolean
  readonly created_at: string
}

export interface KensaurusMeWallet {
  /** Sell-value micro-USD (1e6 = $1). */
  readonly balance_micro: number
  /** floor(balance_micro / 10000): 1 credit = $0.01. */
  readonly credits: number
  /** Positive ledger rows of grant_free, grant_stamp and adjustment. */
  readonly lifetime_earned_micro: number
  /** Positive ledger rows of purchase, iap_purchase and revenuecat_purchase. */
  readonly lifetime_purchased_micro: number
}

/** One stamp per app, earned at that app's activation event. */
export interface KensaurusMeStamp {
  readonly app: KensaurusAppId
  readonly earned_at: string
  readonly credits_micro: number
  readonly credit_pending: boolean
}

/** A row of kensaurus_app_links: apps this account has opened while signed in. */
export interface KensaurusMeApp {
  readonly app: KensaurusAppId
  readonly first_seen_at: string
  readonly last_seen_at: string
  readonly activated_at: string | null
}

/** A per-app paid tier projected into kensaurus_entitlements (feature = plan). Empty today. */
export interface KensaurusMePlan {
  readonly app: KensaurusAppId
  readonly plan: string | null
  readonly source: string
  readonly expires_at: string | null
}

export interface KensaurusMeReferral {
  /** Read-only here; minted by kensaurus-referral-create when the user taps Invite. */
  readonly code: string | null
  readonly redeemed_count: number
}

/** Wallet debits since the first of the current UTC month. */
export interface KensaurusMeMonth {
  readonly provider_cost_micro: number
  readonly debits: number
  /** YYYY-MM-DD */
  readonly since: string
}

/** Constants from kensaurus_config, so copy never hardcodes a number. */
export interface KensaurusMeConfig {
  readonly stamp_credits: number
  readonly welcome_credits: number
  readonly apps_total: number
}

export interface KensaurusMe {
  readonly profile: KensaurusMeProfile
  readonly wallet: KensaurusMeWallet
  readonly stamps: readonly KensaurusMeStamp[]
  readonly apps: readonly KensaurusMeApp[]
  readonly plans: readonly KensaurusMePlan[]
  readonly referral: KensaurusMeReferral
  readonly month: KensaurusMeMonth
  readonly config: KensaurusMeConfig
}
