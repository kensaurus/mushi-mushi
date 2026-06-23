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
 *             that hasn't refreshed entitlements yet). Dispatches a
 *             warn toast via `ToastProvider` so the user is never
 *             dropped on a silent error.
 *
 *          Visual language is Mushi-Admin (amber/violet/sumi), not the
 *          editorial cloud surface — this is the operator console.
 */
import { useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { BILLING_CTA_LINK_CLASS_MD } from '../../lib/tokens'
import { useToast } from '../../lib/toast'
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
  inventory_v2: {
    title: 'Bidirectional inventory (truth layer)',
    tagline:
      'Map user stories to actions, run CI gates for agentic failure modes, and correlate reports with the same graph nodes.',
    bullets: [
      'inventory.yaml → positive graph (pages, elements, actions, API deps).',
      'Five gates: dead handler, mock leak, API contract, crawl drift, status claims.',
      'Synthetic probes and status reconciler keep verified actions honest in prod.',
    ],
  },
  rewards_program: {
    title: 'Rewards program',
    tagline:
      'Incentivize users to report bugs, explore your app, and give feedback — award points, tier badges, and host-side credits.',
    bullets: [
      'Configurable point rules per action (bug report, page visit, drill completion, etc.).',
      'Tier ladder — Free → Explorer → Contributor → Champion — with HMAC-signed host webhooks.',
      'Anti-fraud velocity caps and per-user lifetime limits built in.',
    ],
  },
  rewards_monetary: {
    title: 'Monetary rewards (Stripe Connect)',
    tagline:
      'Pay top contributors directly via Stripe Connect Express — configurable per-tier USD amounts.',
    bullets: [
      'Stripe Connect Express onboarding — contributors receive funds to their bank account.',
      'Monthly payout aggregator with configurable per-tier amounts.',
      'Payout liability dashboard and dispute resolution flow.',
    ],
  },
  marketplace_publish: {
    title: 'Marketplace publishing',
    tagline: 'Publish your Mushi plugin or integration to the public marketplace.',
    bullets: [
      'One-click publish flow with semver versioning.',
      'Automated security scan before listing goes live.',
      'Usage analytics and ratings dashboard.',
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
    <div className="rounded-xl border border-brand/30 bg-brand/5 p-6 shadow-sm">
      <div className="flex flex-col gap-1">
        <p className="text-2xs uppercase tracking-[0.18em] text-brand font-semibold">
          Locked on your current plan
        </p>
        <h2 className="text-xl font-semibold text-fg">{copy.title}</h2>
        <p className="text-sm text-fg-muted">{copy.tagline}</p>
      </div>

      <ul className="mt-4 grid gap-2 text-sm text-fg">
        {copy.bullets.map((b) => (
          <li key={b} className="flex items-start gap-2">
            <span aria-hidden className="mt-1 inline-block h-1.5 w-1.5 rounded-full bg-brand" />
            <span>{b}</span>
          </li>
        ))}
      </ul>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Link
          to="/billing"
          className={BILLING_CTA_LINK_CLASS_MD}
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

/** Suppress repeat upgrade toasts from background polls (e.g. nav counts). */
const UPGRADE_TOAST_COOLDOWN_MS = 60_000
const lastUpgradeToastAt = new Map<string, number>()

/**
 * Root-mounted listener. On `mushi:entitlement-blocked` (402 from apiFetch)
 * pushes a warn toast with a "View plans" action — same stack as every
 * other mutation feedback, no duplicate fixed panel in the corner.
 */
export function UpgradePromptHost() {
  const toast = useToast()
  const navigate = useNavigate()

  useEffect(() => {
    function handler(ev: Event) {
      const detail = (ev as CustomEvent<BlockedDetail>).detail
      if (!detail?.flag) return
      const now = Date.now()
      const last = lastUpgradeToastAt.get(detail.flag) ?? 0
      if (now - last < UPGRADE_TOAST_COOLDOWN_MS) return
      lastUpgradeToastAt.set(detail.flag, now)
      const copy = FEATURE_COPY[detail.flag]
      toast.push({
        tone: 'warn',
        title: `${copy?.title ?? detail.flag} requires a plan upgrade`,
        description: detail.upgradeTo
          ? `${detail.upgradeTo.display_name} ($${detail.upgradeTo.monthly_price_usd}/mo) unlocks this.`
          : 'Pick a plan that includes this feature.',
        duration: 12_000,
        action: { label: 'View plans', onClick: () => navigate('/billing') },
      })
    }
    window.addEventListener('mushi:entitlement-blocked', handler)
    return () => window.removeEventListener('mushi:entitlement-blocked', handler)
  }, [toast, navigate])

  return null
}
