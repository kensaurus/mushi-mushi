/**
 * FILE: apps/admin/src/components/ci/CiCostSection.tsx
 * PURPOSE: /ci "Cost and speed" (Plan 022 Phase 7, ADR 0037). What CI costs
 *          and how fast it runs on GitHub-hosted runners versus your own
 *          machines: included minutes per GitHub account, the per repo ×
 *          runner table, your machines' busy time, speed measured on jobs
 *          that passed on both, what-ifs, why it costs what it costs, and
 *          cost advice. Read-only: nothing here changes where CI runs.
 *
 *          Bucket B under ADR 0016: it sits below "Speed it up", never the
 *          top of /ci. Data: GET /v1/admin/ci/compare (same scope as the
 *          overview).
 */

import { Link } from 'react-router-dom'
import type { CiCompare } from '../../lib/ciCompareTypes'
import { formatDelta, formatMinutes, formatMoney, formatPercent } from '../../lib/ciCompareView'
import { formatSeconds } from '../../lib/ciView'
import { usePageData } from '../../lib/usePageData'
import { Callout, ErrorAlert, Loading } from '../ui'
import { IconAlertTriangle, IconCost, IconServer } from '../icons'
import { CiAdviceList } from './CiSections'
import { CiCompareTable } from './CiCompareTable'
import { CiCostExplainer } from './CiCostExplainer'

export const CI_COST_SETTINGS_HREF = '/settings?tab=ci-cost'

function Accounts({ data }: { data: CiCompare }) {
  if (data.accounts.length === 0) return null
  return (
    <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3" data-testid="ci-cost-accounts">
      {data.accounts.map((a) => {
        const used = a.includedMinutes > 0 ? Math.min(1, a.monthMinutes / a.includedMinutes) : 1
        return (
          <li key={a.owner} className="rounded-md border border-edge-subtle p-2.5">
            <p className="text-xs font-semibold text-fg">
              {a.owner} <span className="font-normal text-fg-muted">· GitHub {a.plan}</span>
            </p>
            <p className="mt-1 text-lg font-semibold tabular-nums text-fg">
              {formatMoney(a.monthCost, a.currency)}
              <span className="ml-1 text-2xs font-normal text-warn-foreground">a month, estimated</span>
            </p>
            <p className="text-2xs text-fg-muted">
              About {formatMinutes(a.monthMinutes)} on {a.privateRepos} private repo{a.privateRepos === 1 ? '' : 's'}; {a.includedMinutes.toLocaleString('en-US')} included
              {a.includedLeft > 0 ? `, ${a.includedLeft.toLocaleString('en-US')} left` : ', all used'}. List price {formatMoney(a.monthListCost, a.currency)}.
            </p>
            <div
              className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-overlay"
              role="meter"
              aria-label={`${a.owner}: included minutes used`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(used * 100)}
            >
              <div className={`h-full ${used >= 1 ? 'bg-warn' : 'bg-ok'}`} style={{ width: `${Math.round(used * 100)}%` }} />
            </div>
          </li>
        )
      })}
    </ul>
  )
}

function Machines({ data }: { data: CiCompare }) {
  if (data.machines.length === 0) return null
  return (
    <div>
      <h3 className="mb-1 text-xs font-semibold text-fg">Your machines</h3>
      <p className="mb-1.5 text-2xs text-fg-muted">
        Busy time is measured (parallel jobs count once). Electricity is the extra draw while busy, from{' '}
        {data.settings.every((s) => s.source === 'default') ? 'example figures' : 'your figures'}: estimated.
      </p>
      <ul className="flex flex-col divide-y divide-edge-subtle" data-testid="ci-cost-machines">
        {data.machines.map((m) => (
          <li key={m.name} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 py-1.5 text-xs">
            <IconServer size={14} className="shrink-0 text-brand" />
            <span className="font-medium text-fg">{m.name}</span>
            {m.online === false && <span className="text-2xs text-warn-foreground">offline</span>}
            <span className="text-fg-secondary tabular-nums">
              busy {m.busyHours} h ({formatPercent(m.busyShare)})
            </span>
            <span className="text-fg-secondary tabular-nums">wait p95 {formatSeconds(m.queueP95s)}</span>
            <span className="ml-auto tabular-nums text-fg">
              {formatMoney(m.monthEnergyCost + m.monthWearCost + m.monthPlatformFee, m.currency)} a month
            </span>
            <span className="w-full text-2xs text-fg-muted">
              {m.runners.join(', ')} · {m.wattsLoad - m.wattsIdle} W extra under load
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function Speed({ data }: { data: CiCompare }) {
  const measured = data.speed.filter((s) => s.factor != null)
  const thin = data.speed.length - measured.length
  if (data.speed.length === 0) return null
  return (
    <div>
      <h3 className="mb-1 text-xs font-semibold text-fg">Speed: your machine vs GitHub</h3>
      <p className="mb-1.5 text-2xs text-fg-muted">Measured only on jobs that passed on both, with at least 5 runs on each side. Under 1× means your machine is faster.</p>
      {measured.length > 0 ? (
        <ul className="flex flex-col gap-1 text-xs" data-testid="ci-cost-speed">
          {measured.map((s) => (
            <li key={`${s.repo}|${s.workflow}|${s.job}`} className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-medium text-fg">{s.job}</span>
              <span className="text-2xs text-fg-muted">
                {s.repo} · {s.workflow}
              </span>
              <span className="tabular-nums text-fg-secondary">
                {formatSeconds(s.hostedP50s)} → {formatSeconds(s.selfHostedP50s)}
              </span>
              <span className="font-semibold tabular-nums text-fg">{s.factor}×</span>
              <span className="text-2xs text-fg-muted">
                ({s.hostedSamples} and {s.selfHostedSamples} runs)
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-fg-muted">Not measured yet: no job has passed 5 times on each side.</p>
      )}
      {thin > 0 && measured.length > 0 && (
        <p className="mt-1 text-2xs text-fg-muted">
          {thin} more job{thin === 1 ? '' : 's'} ran on both, with too few passed runs to measure.
        </p>
      )}
    </div>
  )
}

function WhatIfs({ data }: { data: CiCompare }) {
  if (data.whatIfs.length === 0) return null
  return (
    <div>
      <h3 className="mb-1 text-xs font-semibold text-fg">What if</h3>
      <p className="mb-1.5 text-2xs text-fg-muted">Estimates for 30 days. Moving a workflow is your decision; this only shows what would change.</p>
      <ul className="grid gap-2 lg:grid-cols-2" data-testid="ci-cost-whatifs">
        {data.whatIfs.map((w) => {
          const saves = w.monthCostDelta < 0
          const to = w.to.machine ?? w.to.label
          return (
            <li key={w.id} className="flex flex-col gap-1 rounded-md border border-edge-subtle p-2.5 text-xs">
              <p className="font-medium text-fg">
                Move {w.workflow} in <span className="font-mono">{w.repo}</span> to {w.to.runnerClass === 'github_hosted' ? 'GitHub-hosted' : to}
              </p>
              <p className="tabular-nums">
                <span className={saves ? 'font-semibold text-ok' : 'font-semibold text-fg'}>{formatDelta(w.monthCostDelta, w.currency)}</span>
                <span className="text-fg-muted"> a month ({formatMoney(w.monthCostNow, w.currency)} → {formatMoney(w.monthCostAfter, w.currency)}), {formatMinutes(w.monthMinutesMoved)} move</span>
              </p>
              <p className="text-2xs text-fg-secondary">
                Speed: {w.speed.measured ? `${w.speed.factor}× measured (${w.speed.samplesFrom} and ${w.speed.samplesTo} runs)` : 'not measured, assuming the same'}
                {w.targetQueueP95s != null && ` · wait there p95 ${formatSeconds(w.targetQueueP95s)}`}
                {w.targetBusyShareAfter != null && ` · busy ${formatPercent(w.targetBusyShare)} → ${formatPercent(w.targetBusyShareAfter)}`}
              </p>
              {w.stays.length > 0 && (
                <ul className="flex list-disc flex-col gap-0.5 pl-5 text-2xs text-fg-muted">
                  {w.stays.map((s) => (
                    <li key={s.job}>
                      <span className="text-fg-secondary">Stays: {s.job}</span> — {s.reason}
                    </li>
                  ))}
                </ul>
              )}
              {w.warnings.map((warn) => (
                <p key={warn} className="flex items-start gap-1 text-2xs text-warn-foreground">
                  <IconAlertTriangle size={12} className="mt-px shrink-0" />
                  {warn}
                </p>
              ))}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export function CiCostSection({ projectId, scope }: { projectId: string | null; scope: 'project' | 'all' }) {
  const path = scope === 'project' && projectId ? `/v1/admin/ci/compare?project_id=${encodeURIComponent(projectId)}&days=30` : '/v1/admin/ci/compare?days=30'
  const page = usePageData<CiCompare>(path, { scope: scope === 'all' ? 'enumeration' : 'project' })
  const data = page.data

  if (!data) {
    if (page.error) return <ErrorAlert title="Cost and speed" message={page.error} onRetry={page.reload} />
    return page.loading ? <Loading text="Working out what CI costs…" /> : null
  }

  const exampleFigures = data.settings.every((s) => s.source === 'default')
  return (
    <div className="flex flex-col gap-4" data-testid="ci-cost-section">
      <p className="text-xs text-fg-muted">
        GitHub-hosted runners versus your own machines, over the last {data.window.days} days. Wait and run times are measured; minutes billed and money are
        estimated from GitHub’s list prices (read {data.rates.fetchedAt}). GitHub’s bill is the real figure.
      </p>
      {data.lowConfidence && (
        <Callout tone="warn" label="Thin data" icon={<IconAlertTriangle size={14} />}>
          Only {data.dataDays} days of job data so far. Every figure here will move; trust it after a week.
        </Callout>
      )}
      {data.sourceNote && <Callout tone="neutral" label="Partial">{data.sourceNote}</Callout>}
      {exampleFigures && (
        <Callout tone="neutral" label="Example figures" icon={<IconCost size={14} />}>
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>Electricity and your GitHub plan use example figures.</span>
            <Link to={CI_COST_SETTINGS_HREF} className="font-medium text-brand hover:underline">
              Set yours in Settings → CI cost
            </Link>
          </span>
        </Callout>
      )}
      <Accounts data={data} />
      <CiCompareTable data={data} />
      <Machines data={data} />
      <Speed data={data} />
      <WhatIfs data={data} />
      <div>
        <h3 className="mb-1 text-xs font-semibold text-fg">Why it costs what it costs</h3>
        <CiCostExplainer data={data} />
      </div>
      {data.advice.length > 0 && (
        <div>
          <h3 className="mb-1 text-xs font-semibold text-fg">Cost advice</h3>
          <CiAdviceList advice={data.advice} />
        </div>
      )}
    </div>
  )
}
