import { EmptyState } from '../ui'
import type { ReportDetail, ReportTimelineEntry } from './types'

export function TimelineCard({ report }: { report: ReportDetail }) {
  const timeline = Array.isArray(report.repro_timeline) ? report.repro_timeline : []
  if (timeline.length === 0) {
    return (
      <EmptyState
        title="No repro timeline"
        description="Upgrade the SDK to capture route changes, clicks, logs, and requests in one chronological trail."
      />
    )
  }

  return (
    <ol className="space-y-2">
      {timeline.slice(-40).map((entry, index) => (
        <li key={`${entry.ts}-${entry.kind}-${index}`} className="rounded-md border border-edge-subtle bg-surface-raised/30 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-accent">
              {entry.kind}
            </span>
            <time className="font-mono text-2xs text-fg-faint">
              {formatTime(entry.ts)}
            </time>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-fg-secondary wrap-break-word">
            {describeEntry(entry)}
          </p>
        </li>
      ))}
    </ol>
  )
}

function formatTime(ts: number): string {
  try {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  } catch {
    return String(ts)
  }
}

function describeEntry(entry: ReportTimelineEntry): string {
  const p = entry.payload ?? {}
  switch (entry.kind) {
    case 'route':
      return `Route changed to ${stringify(p.route ?? p.href ?? 'unknown route')}`
    case 'screen':
      return `Screen set to ${stringify(p.name ?? 'unknown screen')}${p.feature ? ` (${stringify(p.feature)})` : ''}`
    case 'click':
      return `Clicked ${stringify(p.tag ?? 'element')}${p.id ? `#${stringify(p.id)}` : ''}${p.text ? ` — ${stringify(p.text)}` : ''}`
    case 'request':
      return `${stringify(p.method ?? 'GET')} ${stringify(p.url ?? '')} → ${stringify(p.status ?? 'error')} (${stringify(p.duration ?? '?')}ms)`
    case 'log':
      return `${stringify(p.level ?? 'log')}: ${stringify(p.message ?? '')}`
  }
}

function stringify(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}
