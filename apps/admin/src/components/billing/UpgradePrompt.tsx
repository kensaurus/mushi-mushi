/**
 * FILE: apps/admin/src/components/billing/UpgradePrompt.tsx
 * PURPOSE: User-facing translation of a server-side entitlement gate.
 *
 *          Two surfaces in one file because they share the same vocabulary:
 *
 *          1. <UpgradePrompt> — inline panel rendered IN PLACE of a paid
 *             feature's empty form (SsoPage, IntelligencePage, BYOK panel,
 *             Plugins panel) when `useEntitlements().has(flag)` is false.
 *             Pre-empts the 402 round-trip by rendering an editorial
 *             explainer + plan-aware "Upgrade to <plan>" CTA that
 *             deep-links to /billing.
 *
 *          2. <UpgradePromptHost> — root-mounted listener for the
 *             `mushi:entitlement-blocked` event that apiFetch dispatches
 *             on a 402. Catches the case where the FE accidentally
 *             reached a gated mutation (e.g. from a stale cached UI
 *             that hasn't refreshed entitlements yet). Renders a
 *             one-shot toast + "View plans" link so the user is never
 *             dropped on a silent error.
 *
 *          Visual language is Mushi-Admin (amber/violet/sumi), not the
 *          editorial cloud surface — this is the operator console.
 */
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { FeatureFlag, UpgradeTarget } from '../../lib/useEntitlements'

const FEATURE_COPY: Record<FeatureFlag, { title: string; tagline: string; bullets: string[] }> = {
  sso: {
    title: 'Single Sign-On',
    tagline: 'Wire your identity provider into Mushi Mushi.',
    bullets: [
      'SAML 2.0 + OIDC providers (Okta, Azure AD, Google Workspace).',
      'JIT user provisioning with role mapping from group claims.',
      'Domain capture so new sign-ups land on your tenant automatically.',
    ],
  },
  byok: {
    title: 'Bring your own LLM key',
    tagline: 'Route classification + fix synthesis through your own AI vendor account.',
    bullets: [
      'Anthropic, OpenAI, Google, and Firecrawl keys — encrypted at rest.',
      'No re-billing margin from us; you pay your vendor directly.',
      'Per-project key scope so a finance project can use a different vendor.',
    ],
  },
  plugins: {
    title: 'Plugin marketplace',
    tagline: 'Install community + first-party integrations like Slack, Linear, Jira, and PagerDuty.',
    bullets: [
      'Forward classified reports as Slack messages, Linear issues, etc.',
      'OAuth-scoped install — revocable per project, never global.',
      'Plugin SDK for building your own internal handlers.',
    ],
  },
  intelligence_reports: {
    title: 'Intelligence reports',
    tagline: 'Long-running analyses across your full history — root-cause clusters, regression detection.',
    bullets: [
      'Cross-project pattern mining (e.g. "what regressed since 11/02?").',
      'Saved schedules + email summaries.',
      'Exportable as PDF for the weekly readout.',
    ],
  },
  audit_log: {
    title: 'Audit log',
    tagline: 'Tamper-evident record of every admin action with downloadable export.',
    bullets: ['90-day retention.', 'CSV / JSON export.', 'Webhook on each event.'],
  },
  soc2: {
    title: 'SOC 2 controls',
    tagline: 'Trust-center pack: control mappings, evidence vault, vendor assessments.',
    bullets: ['Pre-mapped to AICPA TSC.', 'Auditor-ready evidence export.', 'Vendor sub-processor list.'],
  },
  self_hosted: {
    title: 'Self-hosted deployment',
    tagline: 'Run Mushi Mushi inside your VPC.',
    bullets: ['Helm chart + Terraform module.', 'Air-gapped install supported.', 'Annual contract.'],
  },
  teams: {
    title: 'Teams and shared projects',
    tagline: 'Invite teammates into the same organization and collaborate on every project.',
    bullets: [
      'Shared project access with owner, admin, member, and viewer roles.',
      'Email invitations with an auditable accept flow.',
      'Available on Pro and Enterprise plans.',
    ],
  },
}

interface InlineProps {
  flag: FeatureFlag
  /** Caller's current plan id — shown in the "you're on Hobby" subline. */
  currentPlan?: string
  /** Resolved cheapest plan that includes the flag, from /v1/admin/entitlements. */
  upgradeTo?: UpgradeTarget | null
}

export function UpgradePrompt({ flag, currentPlan, upgradeTo }: InlineProps) {
  const copy = FEATURE_COPY[flag]
  if (!copy) return null

  return (
    <div className="rounded-xl border border-amber-300/40 bg-gradient-to-br from-amber-50/60 via-white to-violet-50/40 dark:from-amber-950/40 dark:via-surface dark:to-violet-950/30 dark:border-amber-700/30 p-6 shadow-sm">
      <div className="flex flex-col gap-1">
        <p className="text-2xs uppercase tracking-[0.18em] text-amber-700 dark:text-amber-400 font-semibold">
          Locked on your current plan
        </p>
        <h2 className="text-xl font-semibold text-fg">{copy.title}</h2>
        <p className="text-sm text-fg-muted">{copy.tagline}</p>
      </div>

      <ul className="mt-4 grid gap-2 text-sm text-fg">
        {copy.bullets.map((b) => (
          <li key={b} className="flex items-start gap-2">
            <span aria-hidden className="mt-1 inline-block h-1.5 w-1.5 rounded-full bg-amber-500" />
            <span>{b}</span>
          </li>
        ))}
      </ul>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Link
          to="/billing"
          className="inline-flex items-center gap-1.5 rounded-full bg-fg px-4 py-2 text-sm font-semibold text-bg shadow-sm hover:opacity-90 transition-opacity"
        >
          {upgradeTo
            ? `Upgrade to ${upgradeTo.display_name} — $${upgradeTo.monthly_price_usd}/mo`
            : 'View plans'}
        </Link>
        {currentPlan && (
          <span className="text-xs text-fg-muted">
            You're on <span className="font-medium text-fg">{currentPlan}</span>.
          </span>
        )}
      </div>
    </div>
  )
}

interface BlockedDetail {
  flag: FeatureFlag
  currentPlan?: string
  upgradeTo?: UpgradeTarget | null
  method?: string
  path?: string
}

/**
 * Root-mounted toast host. Listens for `mushi:entitlement-blocked`
 * events emitted by `apiFetch` on a 402 and shows a single dismissible
 * banner. Self-dismisses after 12s so it can never wedge.
 */
export function UpgradePromptHost() {
  const [blocked, setBlocked] = useState<BlockedDetail | null>(null)

  const dismiss = useCallback(() => setBlocked(null), [])

  useEffect(() => {
    function handler(ev: Event) {
      const detail = (ev as CustomEvent<BlockedDetail>).detail
      if (!detail?.flag) return
      setBlocked(detail)
    }
    window.addEventListener('mushi:entitlement-blocked', handler)
    return () => window.removeEventListener('mushi:entitlement-blocked', handler)
  }, [])

  useEffect(() => {
    if (!blocked) return
    const t = window.setTimeout(() => setBlocked(null), 12_000)
    return () => window.clearTimeout(t)
  }, [blocked])

  if (!blocked) return null

  const copy = FEATURE_COPY[blocked.flag]
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-6 right-6 z-50 max-w-sm rounded-xl border border-amber-300/40 bg-surface p-4 shadow-lg dark:border-amber-700/30"
    >
      <div className="flex items-start gap-3">
        <span aria-hidden className="mt-1 inline-block h-2 w-2 rounded-full bg-amber-500" />
        <div className="flex-1">
          <p className="text-sm font-semibold text-fg">
            {copy?.title ?? blocked.flag} requires a plan upgrade
          </p>
          <p className="mt-1 text-xs text-fg-muted">
            {blocked.upgradeTo
              ? `${blocked.upgradeTo.display_name} ($${blocked.upgradeTo.monthly_price_usd}/mo) unlocks this.`
              : 'Pick a plan that includes this feature.'}
          </p>
          <div className="mt-3 flex items-center gap-2">
            <Link
              to="/billing"
              onClick={dismiss}
              className="rounded-full bg-fg px-3 py-1 text-xs font-semibold text-bg hover:opacity-90"
            >
              View plans
            </Link>
            <button
              type="button"
              onClick={dismiss}
              className="text-xs text-fg-muted hover:text-fg"
            >
              Dismiss
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
