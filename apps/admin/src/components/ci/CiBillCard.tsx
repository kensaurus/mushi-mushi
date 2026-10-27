/**
 * FILE: apps/admin/src/components/ci/CiBillCard.tsx
 * PURPOSE: /ci "Your real bill": what GitHub actually charged for Actions,
 *          from GitHub's billing usage API (GET /v1/admin/ci/bill). It sits
 *          at the top of "Cost and speed", above the estimates: this
 *          month's net in large type, gross against net in one line, net per
 *          repo, a daily strip for the window, and how much of the paid
 *          minutes ran on Mushi's agent branches. Without a bill it says
 *          exactly how to connect one. Read-only.
 */

import type { CiBill } from '../../lib/ciBillTypes'
import { formatDelta, formatMinutes, formatMoney, formatPercent } from '../../lib/ciCompareView'
import { usePageData } from '../../lib/usePageData'
import { BarSparkline } from '../charts'
import { Callout, CodeValue, ErrorAlert, Loading } from '../ui'
import { IconCost } from '../icons'

const MAX_REPOS = 8

function RepoBars({ bill }: { bill: CiBill }) {
  const repos = bill.byRepo.filter((r) => r.grossUsd > 0 || r.netUsd > 0).slice(0, MAX_REPOS)
  if (repos.length === 0) return <p className="text-xs text-fg-muted">No Actions usage in these {bill.window.days} days.</p>
  const max = Math.max(...repos.map((r) => r.grossUsd), 0.01)
  return (
    <ul className="flex flex-col gap-1.5" data-testid="ci-bill-repos">
      {repos.map((r) => (
        <li key={r.repo || '(none)'} className="flex flex-col gap-0.5 text-xs">
          <div className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 truncate font-mono text-fg" title={r.repo || 'No repository'}>
              {r.repo || 'No repository'}
            </span>
            <span className="shrink-0 tabular-nums font-semibold text-fg">{formatMoney(r.netUsd)}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-surface-overlay" aria-hidden="true">
            {/* Gross is the whole bar; the darker part is what was charged. */}
            <div className="relative h-full bg-brand/30" style={{ width: `${Math.max(2, Math.round((r.grossUsd / max) * 100))}%` }}>
              <div className="absolute inset-y-0 left-0 bg-brand" style={{ width: r.grossUsd > 0 ? `${Math.round((r.netUsd / r.grossUsd) * 100)}%` : '0%' }} />
            </div>
          </div>
          <span className="text-2xs text-fg-muted">
            {r.netUsd === 0 && r.grossUsd > 0 ? 'free: ' : ''}gross {formatMoney(r.grossUsd)}
            {r.minutes > 0 ? ` · ${formatMinutes(r.minutes)}` : ''}
          </span>
        </li>
      ))}
    </ul>
  )
}

function Connect({ bill }: { bill: CiBill }) {
  return (
    <div className="flex flex-col gap-2" data-testid="ci-bill-connect">
      <p className="text-xs text-fg-secondary">{bill.unavailableReason}</p>
      <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-xs text-fg-secondary">
        <li>
          In this project&apos;s GitHub settings, save a fine-grained token that can read billing: <span className="font-medium text-fg">Plan: read</span> for a
          personal account, <span className="font-medium text-fg">Administration: read</span> for an organization. Mushi reads the bill once a day.
        </li>
        <li className="min-w-0">
          Or, on a machine where <code className="mushi-code-inline">gh</code> is signed in as the account that pays, give that login billing access
          once (it has none by default) and upload the bill:
          <CodeValue value="gh auth refresh -s user" className="mt-1" />
          <CodeValue value="mushi runner bill --push" className="mt-1" />
        </li>
      </ol>
      {bill.owners.some((o) => o.lastError) && (
        <ul className="flex flex-col gap-0.5 text-2xs text-fg-muted">
          {bill.owners
            .filter((o) => o.lastError)
            .map((o) => (
              <li key={o.owner}>
                {o.owner}: {o.lastError}
              </li>
            ))}
        </ul>
      )}
    </div>
  )
}

export function CiBillCard({ projectId, scope }: { projectId: string | null; scope: 'project' | 'all' }) {
  const path = scope === 'project' && projectId ? `/v1/admin/ci/bill?project_id=${encodeURIComponent(projectId)}&days=30` : '/v1/admin/ci/bill?days=30'
  const page = usePageData<CiBill>(path, { scope: scope === 'all' ? 'enumeration' : 'project' })
  const bill = page.data

  if (!bill) {
    if (page.error) return <ErrorAlert title="Your real bill" message={page.error} onRetry={page.reload} />
    return page.loading ? <Loading text="Reading your GitHub bill…" /> : null
  }

  return (
    <section className="flex flex-col gap-3 rounded-md border border-edge-subtle p-3" data-testid="ci-bill-card" aria-labelledby="ci-bill-title">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 id="ci-bill-title" className="flex items-center gap-1.5 text-xs font-semibold text-fg">
          <IconCost size={14} className="text-brand" />
          Your real bill
        </h3>
        <span className="text-2xs text-fg-muted">From GitHub&apos;s billing, measured</span>
      </div>

      {!bill.available ? (
        <Connect bill={bill} />
      ) : (
        <>
          <div>
            <p className="text-3xl font-semibold tabular-nums text-fg" data-testid="ci-bill-month-net">
              {formatMoney(bill.month.netUsd)}
            </p>
            <p className="text-xs text-fg-secondary">
              Charged for Actions in {bill.month.label} so far. Gross {formatMoney(bill.month.grossUsd)}: public repos and included minutes are free.
            </p>
            {bill.change && (
              <p className="mt-0.5 text-2xs text-fg-muted" data-testid="ci-bill-change">
                Last {bill.window.days} days {formatMoney(bill.totals.netUsd)}, {formatDelta(bill.change.netUsd)} against the {bill.window.days} days before
                {bill.change.netPct != null ? ` (${bill.change.netPct > 0 ? '+' : ''}${formatPercent(bill.change.netPct)})` : ''}.
              </p>
            )}
            {bill.repoScoped && (
              <p className="mt-0.5 text-2xs text-fg-muted" data-testid="ci-bill-repo-scoped">
                Showing the repositories of your projects only: the whole account&apos;s bill is visible to members of the organization.
              </p>
            )}
            {!bill.windowComplete && (
              <p className="mt-0.5 text-2xs text-fg-muted">Mushi holds part of this window so far; the totals grow as earlier days are read.</p>
            )}
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="min-w-0">
              <h4 className="mb-1.5 text-2xs font-semibold uppercase tracking-wider text-fg-muted">Net per repo, last {bill.window.days} days</h4>
              <RepoBars bill={bill} />
            </div>
            <div className="min-w-0">
              <h4 className="mb-1.5 text-2xs font-semibold uppercase tracking-wider text-fg-muted">Net per day</h4>
              <BarSparkline
                values={bill.byDay.map((d) => d.netUsd)}
                timestamps={bill.byDay.map((d) => `${d.day}T00:00:00Z`)}
                barTitles={bill.byDay.map((d) => `${d.day}: ${formatMoney(d.netUsd)} net, ${formatMoney(d.grossUsd)} gross`)}
                valueFormat="usd"
                height={56}
                ariaLabel={`Net Actions charge per day, last ${bill.window.days} days`}
              />
              {bill.dataThrough && <p className="mt-1 text-2xs text-fg-muted">GitHub&apos;s bill read through {bill.dataThrough}.</p>}
            </div>
          </div>
        </>
      )}

      {bill.agentShare && (
        <Callout tone="neutral" label="Mushi agent pull requests">
          <p className="text-xs text-fg-secondary" data-testid="ci-bill-agent-share">
            <span className="font-semibold text-fg">{formatPercent(bill.agentShare.share)}</span> of the paid GitHub-hosted minutes ran on Mushi&apos;s agent branches (
            {formatMinutes(bill.agentShare.agentBilledMinutes)} of {formatMinutes(bill.agentShare.billedMinutes)}, private repos, estimated from the jobs Mushi
            recorded).
          </p>
        </Callout>
      )}
    </section>
  )
}
