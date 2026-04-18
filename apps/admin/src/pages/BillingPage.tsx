/**
 * FILE: apps/admin/src/pages/BillingPage.tsx
 * PURPOSE: Wave 4.2 — first-class billing surface for the Mushi Cloud
 *          product. Replaces the old "go to Stripe and squint" workflow
 *          with a real plan + usage + invoices view per project.
 *
 *          Each project card shows:
 *            - Current plan (free / metered) with status pill
 *            - This-month usage bar against free quota or unlimited
 *            - Upgrade CTA → Stripe Checkout (subscription mode)
 *            - Manage CTA → Stripe Billing Portal (card / cancel / invoices)
 *            - Recent invoices with hosted links + PDF downloads
 *
 *          Reads /v1/admin/billing (aggregate across owned projects) and
 *          /v1/admin/billing/invoices?project_id=… per project.
 *          Mutates via /billing/checkout and /billing/portal which return
 *          Stripe-hosted URLs we redirect to.
 */

import { useCallback, useState } from 'react'
import { apiFetch } from '../lib/supabase'
import { usePageData } from '../lib/usePageData'
import { useToast } from '../lib/toast'
import { useAuth } from '../lib/auth'
import {
  PageHeader,
  PageHelp,
  Card,
  Btn,
  Badge,
  Loading,
  ErrorAlert,
  EmptyState,
  RelativeTime,
} from '../components/ui'

interface BillingProject {
  project_id: string
  project_name: string
  plan: string
  subscription: {
    status?: string
    stripe_price_id?: string
    current_period_start?: string
    current_period_end?: string
    cancel_at_period_end?: boolean
  } | null
  customer: {
    stripe_customer_id?: string
    default_payment_ok?: boolean
    email?: string | null
  } | null
  period_start: string
  usage: {
    reports: number
    fixes: number
    tokens: number
  }
  limit_reports: number | null
  over_quota: boolean
}

interface BillingResponse {
  projects: BillingProject[]
  free_limit_reports_per_month: number
}

interface Invoice {
  id: string
  number: string | null
  status: string
  amount_due: number
  amount_paid: number
  currency: string
  created: number
  hosted_invoice_url: string | null
  invoice_pdf: string | null
  period_start: number
  period_end: number
}

const STATUS_TONE: Record<string, string> = {
  active: 'bg-ok-muted text-ok',
  trialing: 'bg-brand-subtle text-brand',
  past_due: 'bg-warn/10 text-warn',
  canceled: 'bg-surface-overlay text-fg-muted',
  unpaid: 'bg-danger-subtle text-danger',
  free: 'bg-surface-overlay text-fg-muted',
}

const formatMoney = (amountMinor: number, currency: string) => {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency.toUpperCase(),
    }).format(amountMinor / 100)
  } catch {
    return `${(amountMinor / 100).toFixed(2)} ${currency.toUpperCase()}`
  }
}

export function BillingPage() {
  const toast = useToast()
  const { user } = useAuth()
  const billingQuery = usePageData<BillingResponse>('/v1/admin/billing')
  const billing = billingQuery.data
  const projects = billing?.projects ?? []

  const [actioning, setActioning] = useState<string | null>(null)

  const startCheckout = useCallback(async (projectId: string) => {
    if (!user?.email) {
      toast.error('Email required', 'Sign in with an email-backed account before subscribing.')
      return
    }
    setActioning(`checkout:${projectId}`)
    const res = await apiFetch<{ url: string }>('/v1/admin/billing/checkout', {
      method: 'POST',
      body: JSON.stringify({ project_id: projectId, email: user.email }),
    })
    setActioning(null)
    if (!res.ok || !res.data?.url) {
      const code = res.error?.code
      if (code === 'STRIPE_NOT_CONFIGURED') {
        toast.error('Stripe not configured', 'Set STRIPE_SECRET_KEY and STRIPE_DEFAULT_PRICE_ID on the API function.')
      } else {
        toast.error('Checkout failed', res.error?.message)
      }
      return
    }
    window.location.href = res.data.url
  }, [user?.email, toast])

  const openPortal = useCallback(async (projectId: string) => {
    setActioning(`portal:${projectId}`)
    const res = await apiFetch<{ url: string }>('/v1/admin/billing/portal', {
      method: 'POST',
      body: JSON.stringify({ project_id: projectId }),
    })
    setActioning(null)
    if (!res.ok || !res.data?.url) {
      toast.error('Could not open billing portal', res.error?.message)
      return
    }
    window.open(res.data.url, '_blank', 'noopener,noreferrer')
  }, [toast])

  if (billingQuery.loading) return <Loading text="Loading billing…" />
  if (billingQuery.error) {
    return <ErrorAlert message={`Failed to load billing: ${billingQuery.error}`} onRetry={billingQuery.reload} />
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Billing">
        <span className="text-2xs text-fg-faint font-mono">
          Free quota: {billing?.free_limit_reports_per_month?.toLocaleString() ?? '—'} reports / mo
        </span>
      </PageHeader>

      <PageHelp
        title="About Billing"
        whatIsIt="Per-project subscription + usage view. The free tier gives every project a monthly quota of report ingests; subscriptions unlock unlimited reports + usage-based pricing on Stripe Meter Events."
        useCases={[
          'Upgrade to Cloud Starter when you hit the free quota and reports are being rejected with HTTP 402',
          'Open the Stripe Billing Portal to update your card, download invoices, or cancel',
          'Cross-check usage between Mushi (reports/fixes/tokens) and Stripe (line items)',
        ]}
        howToUse="Each project bills independently. Click Upgrade to start a Stripe Checkout session, or Manage to jump into the customer portal. Recent invoices appear inline once Stripe sends the first one."
      />

      {projects.length === 0 ? (
        <EmptyState
          title="No projects yet"
          description="Create a project from the Projects page to start tracking usage and billing."
        />
      ) : (
        <div className="space-y-3">
          {projects.map((p) => (
            <ProjectBillingCard
              key={p.project_id}
              project={p}
              actioning={actioning}
              onUpgrade={() => startCheckout(p.project_id)}
              onManage={() => openPortal(p.project_id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

interface CardProps {
  project: BillingProject
  actioning: string | null
  onUpgrade: () => void
  onManage: () => void
}

function ProjectBillingCard({ project, actioning, onUpgrade, onManage }: CardProps) {
  const subscribed = !!project.subscription && ['active', 'trialing', 'past_due'].includes(project.subscription.status ?? '')
  const planLabel = subscribed ? 'Cloud Starter (metered)' : 'Free'
  const statusLabel = subscribed ? (project.subscription?.status ?? 'active') : 'free'
  const usagePct = project.limit_reports
    ? Math.min(100, Math.round((project.usage.reports / project.limit_reports) * 100))
    : null

  return (
    <Card className="p-3 space-y-3">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-fg">{project.project_name}</h3>
          <div className="flex items-center gap-2 mt-0.5">
            <Badge className={STATUS_TONE[statusLabel] ?? 'bg-surface-overlay text-fg-muted'}>
              {planLabel}
            </Badge>
            {project.subscription?.cancel_at_period_end && (
              <Badge className="bg-warn/10 text-warn border border-warn/30">
                Cancels at period end
              </Badge>
            )}
            {project.over_quota && (
              <Badge className="bg-danger-subtle text-danger">Over quota — new reports rejected</Badge>
            )}
          </div>
          {project.subscription?.current_period_end && (
            <p className="text-2xs text-fg-faint mt-1">
              Period ends <RelativeTime value={project.subscription.current_period_end} />
            </p>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {!subscribed && (
            <Btn onClick={onUpgrade} disabled={actioning === `checkout:${project.project_id}`}>
              {actioning === `checkout:${project.project_id}` ? 'Opening Stripe…' : 'Upgrade'}
            </Btn>
          )}
          {project.customer?.stripe_customer_id && (
            <Btn variant="ghost" onClick={onManage} disabled={actioning === `portal:${project.project_id}`}>
              {actioning === `portal:${project.project_id}` ? 'Opening…' : 'Manage'}
            </Btn>
          )}
        </div>
      </header>

      <UsageBar usage={project.usage} limitReports={project.limit_reports} pct={usagePct} />

      <InvoicesSection projectId={project.project_id} hasCustomer={!!project.customer?.stripe_customer_id} />
    </Card>
  )
}

interface UsageBarProps {
  usage: BillingProject['usage']
  limitReports: number | null
  pct: number | null
}

function UsageBar({ usage, limitReports, pct }: UsageBarProps) {
  const barColor = pct == null
    ? 'bg-brand'
    : pct >= 100
      ? 'bg-danger'
      : pct >= 80
        ? 'bg-warn'
        : 'bg-ok'
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-2xs text-fg-muted">
        <span>
          Reports this period: <span className="font-mono text-fg">{usage.reports.toLocaleString()}</span>
          {limitReports != null && (
            <> <span className="text-fg-faint">/ {limitReports.toLocaleString()}</span></>
          )}
          {limitReports == null && <> <span className="text-fg-faint">(unlimited)</span></>}
        </span>
        <span className="text-fg-faint">
          Fixes <span className="font-mono text-fg-secondary">{usage.fixes.toLocaleString()}</span>
          {' · '}
          Classifier tokens <span className="font-mono text-fg-secondary">{usage.tokens.toLocaleString()}</span>
        </span>
      </div>
      {limitReports != null && (
        <div className="h-1.5 bg-surface-overlay rounded-sm overflow-hidden" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct ?? 0}>
          <div className={`h-full ${barColor}`} style={{ width: `${Math.max(2, pct ?? 0)}%` }} />
        </div>
      )}
    </div>
  )
}

interface InvoicesSectionProps {
  projectId: string
  hasCustomer: boolean
}

function InvoicesSection({ projectId, hasCustomer }: InvoicesSectionProps) {
  const invoicesQuery = usePageData<{ invoices: Invoice[] }>(
    hasCustomer ? `/v1/admin/billing/invoices?project_id=${encodeURIComponent(projectId)}` : null,
  )

  if (!hasCustomer) {
    return (
      <p className="text-2xs text-fg-faint border-t border-edge-subtle pt-2">
        Invoices appear here after the first Stripe Checkout completes.
      </p>
    )
  }

  if (invoicesQuery.loading) {
    return <p className="text-2xs text-fg-faint border-t border-edge-subtle pt-2">Loading invoices…</p>
  }

  if (invoicesQuery.error) {
    return (
      <p className="text-2xs text-danger border-t border-edge-subtle pt-2">
        Could not load invoices: {invoicesQuery.error}
      </p>
    )
  }

  const invoices = invoicesQuery.data?.invoices ?? []
  if (invoices.length === 0) {
    return (
      <p className="text-2xs text-fg-faint border-t border-edge-subtle pt-2">
        No invoices yet. Stripe issues the first one at the end of the billing period.
      </p>
    )
  }

  return (
    <section className="border-t border-edge-subtle pt-2">
      <h4 className="text-2xs uppercase tracking-wider text-fg-faint mb-1.5">Recent invoices</h4>
      <table className="w-full text-2xs">
        <thead className="text-fg-faint">
          <tr>
            <th scope="col" className="text-left font-medium pb-1">Number</th>
            <th scope="col" className="text-left font-medium pb-1">Period</th>
            <th scope="col" className="text-right font-medium pb-1">Amount</th>
            <th scope="col" className="text-left font-medium pb-1 pl-2">Status</th>
            <th scope="col" className="text-right font-medium pb-1">Links</th>
          </tr>
        </thead>
        <tbody>
          {invoices.map((inv) => (
            <tr key={inv.id} className="border-t border-edge-subtle">
              <td className="py-1 font-mono text-fg-secondary">{inv.number ?? inv.id.slice(0, 12)}</td>
              <td className="py-1 text-fg-muted">
                {new Date(inv.period_start * 1000).toLocaleDateString()} → {new Date(inv.period_end * 1000).toLocaleDateString()}
              </td>
              <td className="py-1 text-right font-mono text-fg">
                {formatMoney(inv.amount_paid > 0 ? inv.amount_paid : inv.amount_due, inv.currency)}
              </td>
              <td className="py-1 pl-2">
                <Badge className={STATUS_TONE[inv.status] ?? 'bg-surface-overlay text-fg-muted'}>
                  {inv.status}
                </Badge>
              </td>
              <td className="py-1 text-right space-x-2">
                {inv.hosted_invoice_url && (
                  <a
                    href={inv.hosted_invoice_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-brand hover:text-brand-hover"
                  >
                    View
                  </a>
                )}
                {inv.invoice_pdf && (
                  <a
                    href={inv.invoice_pdf}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-brand hover:text-brand-hover"
                  >
                    PDF
                  </a>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
