/**
 * FILE: apps/admin/src/components/ci/CiDrawerParts.tsx
 * PURPOSE: Building blocks for the /ci node drawer: stat tiles, a used/total
 *          gauge, a 7-day outcome bar chart, chip rows that jump to another
 *          map node, and the recent-jobs list. Every value has its number in
 *          words beside the bar, so nothing reads by colour or length alone.
 */

import type { ReactNode } from 'react'
import type { CiJob } from '../../lib/ciTypes'
import { CI_OUTCOME_META, formatSeconds, type CiActivity } from '../../lib/ciView'
import { CiJobOutcomeChip } from './CiJobOutcomeChip'
import { Card } from '../ui'

export function DrawerSection({ title, children, hint }: { title: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <section className="mt-4 flex flex-col gap-2 first:mt-0" aria-label={title}>
      <div className="flex items-baseline gap-2">
        <h4 className="text-xs font-semibold text-fg">{title}</h4>
        {hint && <span className="text-3xs text-fg-faint">{hint}</span>}
      </div>
      {children}
    </section>
  )
}

export function StatusLine({ dot, word, why }: { dot: string; word: string; why: string }) {
  return (
    <Card variant="flat" className="flex items-start gap-2 px-3 py-2">
      <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${dot}`} aria-hidden="true" />
      <div className="min-w-0">
        <p className="text-xs font-semibold text-fg">{word}</p>
        <p className="text-2xs leading-snug text-fg-muted">{why}</p>
      </div>
    </Card>
  )
}

export function StatTiles({ tiles }: { tiles: Array<{ label: string; value: string; hint?: string }> }) {
  return (
    <dl className="grid grid-cols-2 gap-2">
      {tiles.map((t) => (
        <div key={t.label} className="min-w-0 rounded-md border border-edge-subtle bg-surface-raised px-2.5 py-2">
          <dt className="truncate text-3xs uppercase tracking-wide text-fg-muted">{t.label}</dt>
          <dd className="text-sm font-semibold text-fg tabular-nums">{t.value}</dd>
          {t.hint && <dd className="truncate text-3xs text-fg-faint">{t.hint}</dd>}
        </div>
      ))}
    </dl>
  )
}

/** A labelled used/total bar; `unit` MB values print as GB. */
export function Gauge({ label, used, total, note }: { label: string; used: number | null | undefined; total: number | null | undefined; note?: string }) {
  if (used == null || total == null || total <= 0) {
    return (
      <div className="flex items-center justify-between gap-3 text-2xs">
        <span className="text-fg-muted">{label}</span>
        <span className="text-fg-faint">{note ?? 'Not reported'}</span>
      </div>
    )
  }
  const pct = Math.min(100, Math.max(0, (used / total) * 100))
  const tone = pct >= 90 ? 'bg-danger' : pct >= 75 ? 'bg-warn' : 'bg-ok'
  const gb = (mb: number) => (mb / 1024).toFixed(1)
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-3 text-2xs">
        <span className="text-fg-muted">{label}</span>
        <span className="text-fg tabular-nums">
          {gb(used)} of {gb(total)} GB · {Math.round(pct)}%
        </span>
      </div>
      <div
        className="h-2 overflow-hidden rounded-full bg-surface-overlay"
        role="meter"
        aria-label={label}
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${pct}%` }} />
      </div>
      {note && <p className="text-3xs text-fg-faint">{note}</p>}
    </div>
  )
}

const BAR_PARTS = [
  { key: 'passed', cls: 'bg-ok', label: CI_OUTCOME_META.passed.label },
  { key: 'failed', cls: 'bg-danger', label: CI_OUTCOME_META.code_failure.label },
  { key: 'infra', cls: 'bg-warn', label: CI_OUTCOME_META.infra.label },
  { key: 'other', cls: 'bg-fg-faint', label: 'Cancelled or skipped' },
] as const

function weekday(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, { weekday: 'short', timeZone: 'UTC' })
}

/** Finished jobs per day for the last 7 days, stacked by outcome. */
export function ActivityBars({ activity }: { activity: CiActivity }) {
  const max = Math.max(1, ...activity.days.map((d) => d.passed + d.failed + d.infra + d.other))
  const totals = BAR_PARTS.map((p) => ({ ...p, n: activity.days.reduce((s, d) => s + d[p.key], 0) }))
  if (activity.finished === 0) {
    return <p className="text-2xs text-fg-muted">No finished jobs in the last 7 days.</p>
  }
  return (
    <div className="flex flex-col gap-2">
      <ol className="flex h-24 items-end gap-1.5" aria-label="Finished jobs per day, last 7 days">
        {activity.days.map((d) => {
          const total = d.passed + d.failed + d.infra + d.other
          if (!d.covered) {
            const none = `${weekday(d.day)} ${d.day}: no data (older than the jobs Mushi holds)`
            return (
              <li key={d.day} className="flex h-full min-w-0 flex-1 flex-col items-center gap-1" title={none} aria-label={none}>
                <span className="text-3xs text-fg-faint">–</span>
                <div className="w-full flex-1 rounded-sm border border-dashed border-edge-subtle" />
                <span className="text-3xs text-fg-faint">{weekday(d.day)}</span>
              </li>
            )
          }
          const words = `${weekday(d.day)} ${d.day}: ${total} job${total === 1 ? '' : 's'} (${d.passed} passed, ${d.failed} failed, ${d.infra} machine stopped, ${d.other} cancelled or skipped)`
          return (
            <li key={d.day} className="flex h-full min-w-0 flex-1 flex-col items-center gap-1" title={words} aria-label={words}>
              <span className="text-3xs text-fg-muted tabular-nums">{total || ''}</span>
              <div className="flex w-full flex-1 flex-col-reverse overflow-hidden rounded-sm bg-surface-overlay/60">
                {BAR_PARTS.map((p) =>
                  d[p.key] ? <div key={p.key} className={p.cls} style={{ height: `${(d[p.key] / max) * 100}%` }} /> : null,
                )}
              </div>
              <span className="text-3xs text-fg-faint">{weekday(d.day)}</span>
            </li>
          )
        })}
      </ol>
      <ul className="flex flex-wrap gap-x-3 gap-y-1 text-3xs text-fg-muted">
        {totals.map((t) => (
          <li key={t.key} className="inline-flex items-center gap-1">
            <span className={`h-2 w-2 rounded-sm ${t.cls}`} aria-hidden="true" />
            {t.label} <span className="tabular-nums text-fg">{t.n}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Chips; one with `nodeId` is a button that opens that map node. */
export function ChipRow({
  items,
  onSelect,
  empty = '—',
}: {
  items: Array<{ key: string; label: string; nodeId?: string; dot?: string; title?: string }>
  onSelect?: (nodeId: string) => void
  empty?: string
}) {
  if (items.length === 0) return <p className="text-2xs text-fg-faint">{empty}</p>
  return (
    <ul className="flex flex-wrap gap-1.5">
      {items.map((it) => {
        const inner = (
          <>
            {it.dot && <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${it.dot}`} aria-hidden="true" />}
            <span className="truncate">{it.label}</span>
          </>
        )
        const cls = 'inline-flex max-w-full items-center gap-1 rounded-sm border border-edge-subtle px-1.5 py-0.5 text-2xs'
        return (
          <li key={it.key} className="min-w-0 max-w-full">
            {it.nodeId && onSelect ? (
              <button
                type="button"
                onClick={() => onSelect(it.nodeId!)}
                title={it.title ?? `Open ${it.label}`}
                className={`${cls} bg-surface-raised text-fg-secondary hover:border-brand/40 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60`}
              >
                {inner}
                <span aria-hidden="true" className="text-fg-faint">
                  →
                </span>
              </button>
            ) : (
              <span className={`${cls} bg-surface-overlay text-fg-secondary`} title={it.title}>
                {inner}
              </span>
            )}
          </li>
        )
      })}
    </ul>
  )
}

export function Facts({ rows }: { rows: Array<[string, ReactNode]> }) {
  return (
    <dl className="flex flex-col gap-1 text-xs">
      {rows.map(([k, v]) => (
        <div key={k} className="flex gap-3">
          <dt className="w-40 shrink-0 text-fg-muted">{k}</dt>
          <dd className="min-w-0 text-fg tabular-nums">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

export function RecentJobs({ jobs, empty, onSelect }: { jobs: CiJob[]; empty: string; onSelect?: (nodeId: string) => void }) {
  const recent = [...jobs].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, 10)
  return (
    <DrawerSection title="Recent jobs">
      {recent.length === 0 ? (
        <p className="text-xs text-fg-muted">{empty}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-edge-subtle">
          {recent.map((j) => (
            <li key={j.id} className="flex flex-col gap-0.5 py-1.5 text-xs">
              <div className="flex min-w-0 items-center gap-2">
                <CiJobOutcomeChip job={j} />
                {onSelect ? (
                  <button
                    type="button"
                    onClick={() => onSelect(`job:${j.id}`)}
                    className="min-w-0 flex-1 truncate text-left font-medium text-fg hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60"
                  >
                    {j.jobName}
                  </button>
                ) : (
                  <span className="min-w-0 flex-1 truncate font-medium text-fg">{j.jobName}</span>
                )}
                <span className="shrink-0 text-fg-muted tabular-nums">{formatSeconds(j.durationSeconds)}</span>
              </div>
              <div className="flex min-w-0 items-center gap-2 text-2xs">
                <span className="min-w-0 flex-1 truncate text-fg-faint">
                  {j.repo}
                  {j.workflowName ? ` · ${j.workflowName}` : ''}
                </span>
                {j.htmlUrl && (
                  <a href={j.htmlUrl} target="_blank" rel="noopener noreferrer" className="shrink-0 text-accent hover:underline">
                    GitHub ↗
                  </a>
                )}
              </div>
              {j.infraDetail && <p className="text-2xs text-fg-muted">{j.infraDetail}</p>}
            </li>
          ))}
        </ul>
      )}
    </DrawerSection>
  )
}
