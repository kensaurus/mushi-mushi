import { EmptyState } from '../ui'
import type { ReportDetail, ReportTimelineEntry } from './types'
import {
  CONSOLE_LEVEL_PILL,
  formatConsoleMessage,
  formatTimelineOffset,
  formatTimelineTime,
  inferLevelFromMessage,
  normaliseConsoleLevel,
  TIMELINE_KIND_PILL,
  type ConsoleLevel,
  type TimelineKind,
} from './reportLogFormat'

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

  const entries = timeline.slice(-48)
  const baseTs = entries[0]?.ts ?? 0

  return (
    <ol className="relative ml-1 max-h-64 overflow-y-auto border-l border-edge-subtle pl-3 pr-1 space-y-1">
      {entries.map((entry, index) => (
        <TimelineRow key={`${entry.ts}-${entry.kind}-${index}`} entry={entry} baseTs={baseTs} index={index} />
      ))}
    </ol>
  )
}

function TimelineRow({
  entry,
  baseTs,
  index,
}: {
  entry: ReportTimelineEntry
  baseTs: number
  index: number
}) {
  const kind = (entry.kind in TIMELINE_KIND_PILL ? entry.kind : 'log') as TimelineKind
  const pillClass = pillForEntry(entry, kind)

  return (
    <li className="relative py-0.5">
      <span
        aria-hidden
        className={`absolute -left-[14px] top-[0.45rem] size-1.5 rounded-full ring-2 ring-surface ${dotForEntry(entry, kind)}`}
      />
      <div className="flex items-start gap-1.5 min-w-0">
        <time
          className="shrink-0 w-[4.5rem] text-3xs font-mono tabular-nums text-fg-faint leading-snug"
          title={formatTimelineTime(entry.ts)}
        >
          {formatTimelineTime(entry.ts)}
        </time>
        <span
          className={`shrink-0 inline-flex items-center rounded-sm px-1 py-px text-3xs font-semibold uppercase tracking-wide ${pillClass}`}
        >
          {kind}
        </span>
        <span className="min-w-0 flex-1 text-2xs leading-snug text-fg-secondary wrap-anywhere">
          {describeEntry(entry)}
        </span>
        {index > 0 ? (
          <span className="shrink-0 text-3xs font-mono tabular-nums text-fg-faint/80">
            {formatTimelineOffset(entry.ts, baseTs)}
          </span>
        ) : null}
      </div>
    </li>
  )
}

function pillForEntry(entry: ReportTimelineEntry, kind: TimelineKind): string {
  if (kind === 'log') {
    const level = logLevelFromEntry(entry)
    return CONSOLE_LEVEL_PILL[level].pill
  }
  return TIMELINE_KIND_PILL[kind]
}

function dotForEntry(entry: ReportTimelineEntry, kind: TimelineKind): string {
  if (kind === 'log') return CONSOLE_LEVEL_PILL[logLevelFromEntry(entry)].dot
  if (kind === 'click') return 'bg-warn'
  if (kind === 'route' || kind === 'screen') return 'bg-brand'
  if (kind === 'request') return 'bg-info'
  return 'bg-fg-faint'
}

function logLevelFromEntry(entry: ReportTimelineEntry): ConsoleLevel {
  const p = entry.payload ?? {}
  const fromPayload = typeof p.level === 'string' ? normaliseConsoleLevel(p.level) : 'log'
  const message = typeof p.message === 'string' ? p.message : ''
  return message ? inferLevelFromMessage(message, fromPayload) : fromPayload
}

function describeEntry(entry: ReportTimelineEntry): string {
  const p = entry.payload ?? {}
  switch (entry.kind) {
    case 'route': {
      const route = stringify(p.route ?? p.href ?? 'unknown route')
      return route.startsWith('http') ? truncateUrl(route) : route
    }
    case 'screen':
      return `${stringify(p.name ?? 'unknown screen')}${p.feature ? ` · ${stringify(p.feature)}` : ''}`
    case 'click': {
      const tag = stringify(p.tag ?? 'element')
      const id = p.id ? `#${stringify(p.id)}` : ''
      const text = p.text ? ` — ${truncate(stringify(p.text), 48)}` : ''
      return `${tag}${id}${text}`
    }
    case 'request':
      return `${stringify(p.method ?? 'GET')} ${truncateUrl(stringify(p.url ?? ''))} → ${stringify(p.status ?? 'error')} (${stringify(p.duration ?? '?')}ms)`
    case 'log': {
      const level = logLevelFromEntry(entry)
      const message = formatConsoleMessage(stringify(p.message ?? ''))
      return message || level
    }
    default:
      return stringify(p)
  }
}

function truncateUrl(url: string): string {
  try {
    const u = new URL(url)
    const path = u.pathname + u.search
    return path.length > 56 ? `${path.slice(0, 53)}…` : path
  } catch {
    return truncate(url, 56)
  }
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value
}

function stringify(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}
