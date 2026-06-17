/**
 * FILE: apps/admin/src/components/billing/UpgradeNudge.tsx
 * PURPOSE: Lighter-weight cousins of `<UpgradePrompt>` for surfaces
 *          where a full editorial card would over-shout. The full
 *          UpgradePrompt replaces a feature's whole form; these
 *          primitives slot inside otherwise-functional pages and
 *          *guide* users to billing instead of blocking them.
 *
 * Three primitives, all reading the same `FeatureFlag` vocabulary as
 * the full prompt so feature-gating stays single-sourced:
 *
 *   1. <UpgradeBanner flag>     — compact horizontal strip with
 *      icon + tagline + Upgrade CTA. Render above a locked form
 *      (e.g. invite-teammate, install-plugin) so the user sees the
 *      plan signal *before* they click into a disabled control.
 *
 *   2. <UpgradePill flag>       — tiny inline badge ("PRO", "TEAMS+")
 *      meant to attach to a label, menu item, or form field that's
 *      gated. No CTA — just a recognition cue.
 *
 *   3. <UpgradeLockOverlay flag> — wraps an existing form/control;
 *      renders the children dimmed + un-pointer-eventable with a
 *      centred lock + Upgrade CTA. The shape that the children would
 *      have rendered is preserved so the page doesn't "jump" between
 *      free and paid views.
 *
 * All three:
 *   - Resolve their own copy from `FEATURE_COPY` in UpgradePrompt
 *     (so we have a single dictionary of titles/taglines/bullets).
 *   - Deep-link to `/billing?focus=<flag>` so the billing page can
 *     scroll the matching plan into view (BillingPage reads the
 *     `focus` query param if present).
 *   - Default to a "View plans" CTA but show "Upgrade to <plan> —
 *     $X/mo" when an `upgradeTo` is supplied by the caller.
 */

import { Link } from 'react-router-dom'
import type { ReactNode } from 'react'
import type { FeatureFlag, UpgradeTarget } from '../../lib/useEntitlements'
import { useEntitlements } from '../../lib/useEntitlements'
import { Tooltip } from '../ui'

// Re-export here so callers don't have to chase imports across modules
// — `<UpgradePill flag="teams" />` should just need this file.
export type { FeatureFlag, UpgradeTarget }

/**
 * Per-feature short copy for the lighter nudges. Keeping it separate
 * from `FEATURE_COPY` in UpgradePrompt because banners need a punchier,
 * one-liner pitch — the editorial card prose is too long for a strip
 * of chrome. `pillLabel` is the 3–6 char tag for `<UpgradePill>`.
 */
const NUDGE_COPY: Record<FeatureFlag, { tagline: string; pillLabel: string }> = {
  sso: {
    tagline: 'Single Sign-On is on Pro. Wire your IdP and stop juggling passwords.',
    pillLabel: 'PRO',
  },
  byok: {
    tagline: 'Bring-your-own LLM keys are on Pro — pay your vendor directly, no margin.',
    pillLabel: 'PRO',
  },
  plugins: {
    tagline: 'Slack, Linear, Jira routing live on the plugin marketplace — Pro and up.',
    pillLabel: 'PRO',
  },
  intelligence_reports: {
    tagline: 'Cross-project root-cause analyses ship with Pro.',
    pillLabel: 'PRO',
  },
  audit_log: {
    tagline: 'Tamper-evident audit log + export comes with Enterprise.',
    pillLabel: 'ENT',
  },
  soc2: {
    tagline: 'SOC 2 control mapping + evidence vault ship with Enterprise.',
    pillLabel: 'ENT',
  },
  self_hosted: {
    tagline: 'Helm chart + Terraform module ship with Enterprise.',
    pillLabel: 'ENT',
  },
  teams: {
    tagline: 'Invite teammates, share projects, and assign roles on Pro.',
    pillLabel: 'PRO',
  },
  inventory_v2: {
    tagline: 'Bidirectional inventory + agent gates ship with Pro.',
    pillLabel: 'PRO',
  },
  rewards_program: {
    tagline: 'Rewards program — points, tiers, and webhooks — requires Starter.',
    pillLabel: 'STARTER',
  },
  rewards_monetary: {
    tagline: 'Monetary payouts via Stripe Connect require Pro.',
    pillLabel: 'PRO',
  },
  marketplace_publish: {
    tagline: 'Publishing to the Mushi Marketplace requires Pro.',
    pillLabel: 'PRO',
  },
}

function ctaCopy(upgradeTo: UpgradeTarget | null | undefined): string {
  return upgradeTo
    ? `Upgrade to ${upgradeTo.display_name} — $${upgradeTo.monthly_price_usd}/mo`
    : 'View plans'
}

function billingHref(flag: FeatureFlag): string {
  return `/billing?focus=${encodeURIComponent(flag)}`
}

interface CommonProps {
  flag: FeatureFlag
  /** Override the default tagline — useful when the surrounding copy
   *  already establishes the feature ("Invite teammate") and we want
   *  the nudge to be punchier ("Pro plan required"). */
  taglineOverride?: string
  upgradeTo?: UpgradeTarget | null
  /** Force-render even when the entitlements call is still loading.
   *  Most callers should leave this false — flashing a banner before
   *  we know whether the user has access reads as anxious. */
  showWhileLoading?: boolean
}

/* ── <UpgradeBanner> ─────────────────────────────────────────────── */

interface BannerProps extends CommonProps {
  /** Optional alternate verb for the CTA (defaults to "Upgrade"). */
  ctaLabel?: string
  /** Visual density. `compact` is one row, `comfy` adds a sub-line. */
  density?: 'compact' | 'comfy'
}

export function UpgradeBanner({
  flag,
  taglineOverride,
  upgradeTo,
  showWhileLoading,
  density = 'compact',
}: BannerProps) {
  const ent = useEntitlements()
  // Render only when the plan actually lacks the feature. Safe-noop
  // when called above an unlocked form — the parent doesn't have to
  // gate-check the call.
  if (ent.has(flag)) return null
  if (ent.loading && !showWhileLoading) return null

  const copy = NUDGE_COPY[flag]
  const tagline = taglineOverride ?? copy.tagline

  return (
    <div
      role="note"
      aria-label={`${flag} requires a plan upgrade`}
      className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-brand/30 bg-brand/5 px-3 py-2 shadow-sm"
    >
      <div className="flex items-start gap-2 min-w-0">
        <span aria-hidden className="mt-0.5 text-brand shrink-0">
          {/* Tiny key/lock glyph — "this is gated" without yelling. */}
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="3.5" y="7" width="9" height="6.5" rx="1" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <div className="min-w-0">
          <p className="text-xs font-medium text-fg leading-snug">
            <span className="text-brand font-semibold tracking-wide">
              {copy.pillLabel}
            </span>{' '}
            <span aria-hidden className="text-fg-faint">·</span> {tagline}
          </p>
          {density === 'comfy' && (
            <p className="text-2xs text-fg-muted mt-0.5">
              You're on{' '}
              <span className="font-medium text-fg">{ent.planName ?? 'your current plan'}</span>.
            </p>
          )}
        </div>
      </div>
      <Link
        to={billingHref(flag)}
        className="inline-flex items-center justify-center rounded-full bg-fg px-3 py-1 text-2xs font-semibold text-bg shadow-sm hover:opacity-90 motion-safe:transition-opacity shrink-0"
      >
        {ctaCopy(upgradeTo)}
      </Link>
    </div>
  )
}

/* ── <UpgradePill> ───────────────────────────────────────────────── */

interface PillProps {
  flag: FeatureFlag
  /** Force the pill on even when the user *has* the feature. Useful
   *  in marketing-style surfaces (e.g. /billing's plan comparison)
   *  where the pill is a signal of "this lives in PRO" regardless of
   *  the viewer's plan. */
  alwaysShow?: boolean
  className?: string
  /** Render mode:
   *
   *    'auto'   (default) — inline `<span>`, no nested anchor. Use
   *      when the pill sits *inside* a parent `<Link>` (sidebar nav
   *      rows, table cells that link to a detail page). The parent
   *      anchor handles the navigation; the pill is purely a visual
   *      marker so we never produce `<a><a>…</a></a>`.
   *    'link'           — render as a billing deep-link. Use when
   *      the pill is the only interactive element in its row (free-
   *      standing badge in a settings header, plan comparison cell). */
  as?: 'auto' | 'link'
}

const PILL_BASE =
  'inline-flex items-center rounded-sm px-1 py-px text-3xs font-semibold tracking-wider uppercase border-0 bg-transparent text-brand/80 hover:text-brand motion-safe:transition-colors'

export function UpgradePill({ flag, alwaysShow, className = '', as = 'auto' }: PillProps) {
  const ent = useEntitlements()
  if (!alwaysShow && ent.has(flag)) return null
  const copy = NUDGE_COPY[flag]

  if (as === 'link') {
    return (
      <Tooltip content={copy.tagline}>
        <Link
          to={billingHref(flag)}
          aria-label={`${copy.pillLabel} feature — view plans`}
          className={`${PILL_BASE} ${className}`}
        >
          {copy.pillLabel}
        </Link>
      </Tooltip>
    )
  }

  // Default — inline `<span>` so it's safe inside any parent anchor.
  // The native `title` provides hover discoverability without our own
  // Tooltip wrapper (which would interfere with the parent's hover
  // state in the sidebar).
  return (
    <span
      title={copy.tagline}
      aria-label={`${copy.pillLabel} feature — upgrade to unlock`}
      className={`${PILL_BASE} cursor-help ${className}`}
    >
      {copy.pillLabel}
    </span>
  )
}

/* ── <UpgradeLockOverlay> ────────────────────────────────────────── */

interface OverlayProps extends CommonProps {
  children: ReactNode
  /** Headline shown above the lock icon. Defaults to the feature's
   *  pill label + " required" (e.g. "PRO required"). */
  headline?: string
  /** When true, render the children at full opacity (still
   *  un-pointer-eventable). Used when the overlay is intentionally
   *  visual-preview-only and we don't want to wash out the design. */
  preview?: boolean
}

/**
 * Wraps children in a non-pointerable, dimmed surface and centres an
 * upgrade CTA over them. Use when the gated surface is rich (a form,
 * a chart, a config panel) and you want to *show* the user what they'd
 * get — same visual shape the form would take if unlocked — without
 * letting them interact with it.
 */
export function UpgradeLockOverlay({
  flag,
  taglineOverride,
  upgradeTo,
  headline,
  preview,
  showWhileLoading,
  children,
}: OverlayProps) {
  const ent = useEntitlements()
  // Pass-through when the user has the feature — the overlay
  // dissolves and the children become fully interactive again.
  if (ent.has(flag)) return <>{children}</>
  if (ent.loading && !showWhileLoading) return <>{children}</>

  const copy = NUDGE_COPY[flag]
  const tagline = taglineOverride ?? copy.tagline
  return (
    <div className="relative">
      <div
        aria-hidden="true"
        className={`pointer-events-none select-none ${preview ? '' : 'opacity-40 saturate-50'}`}
      >
        {children}
      </div>
      <div
        role="dialog"
        aria-label={`${copy.pillLabel} feature locked`}
        className="absolute inset-0 flex items-center justify-center bg-surface/70 backdrop-blur-[2px] rounded-md"
      >
        <div className="flex flex-col items-center gap-2 max-w-sm text-center px-4 py-3 rounded-lg border border-brand/30 bg-surface/90 shadow-card">
          <span aria-hidden className="text-brand">
            <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
              <rect x="3.5" y="7" width="9" height="6.5" rx="1" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <p className="text-xs font-semibold text-fg">
            {headline ?? `${copy.pillLabel} required`}
          </p>
          <p className="text-2xs text-fg-muted">{tagline}</p>
          <Link
            to={billingHref(flag)}
            className="mt-1 inline-flex items-center justify-center rounded-full bg-fg px-3 py-1 text-2xs font-semibold text-bg shadow-sm hover:opacity-90 motion-safe:transition-opacity"
          >
            {ctaCopy(upgradeTo)}
          </Link>
        </div>
      </div>
    </div>
  )
}
