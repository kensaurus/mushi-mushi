import { usePageData } from '../../lib/usePageData'
import { EmptyState, RelativeTime } from '../ui'
import type { UnifiedTimelineEntry, UnifiedTimelineLane } from './types'
import { CHIP_TONE } from '../../lib/chipTone'

const LANE_PILL: Record<UnifiedTimelineLane, string> = {
  report: 'bg-brand/12 text-brand border border-brand/28',
  reporter_comment: CHIP_TONE.infoSubtle,
  admin_comment: CHIP_TONE.warnSubtle,
  fix: CHIP_TONE.okSubtle,
  qa: CHIP_TONE.accentSubtle,
  skill_pipeline: 'bg-brand/12 text-brand border border-brand/28',
  ask_mushi: 'bg-surface-overlay text-fg-muted border border-edge-subtle',
}

const LANE_LABEL: Record<UnifiedTimelineLane, string> = {
  report: 'report',
  reporter_comment: 'reporter',
  admin_comment: 'team',
  fix: 'fix',
  qa: 'qa',
  skill_pipeline: 'pipeline',
  ask_mushi: 'ask',
}

interface UnifiedTimelineResponse {
  report_id: string
  timeline: UnifiedTimelineEntry[]
}

export function UnifiedTimelineCard({ reportId }: { reportId: string }) {
  const path = `/v1/admin/reports/${reportId}/timeline`
  const { data, loading, error } = usePageData<UnifiedTimelineResponse>(path, { deps: [reportId] })

  if (loading) {
    return <div className="text-xs text-fg-muted italic">Loading unified timeline…</div>
  }

  if (error) {
    return (
      <EmptyState
        title="Timeline unavailable"
        description={error}
      />
    )
  }

  const timeline = data?.timeline ?? []
  if (timeline.length === 0) {
    return (
      <EmptyState
        title="No unified timeline"
        description="Comments, fix events, QA runs, and pipeline steps will appear here as the report progresses."
      />
    )
  }

  return (
    <ol className="relative ml-1 max-h-72 overflow-y-auto border-l border-edge-subtle pl-3 pr-1 space-y-1.5">
      {timeline.map((entry) => (
        <li key={entry.id} className="relative py-0.5">
          <span
            aria-hidden
            className="absolute -left-[14px] top-[0.45rem] size-1.5 rounded-full ring-2 ring-surface bg-brand"
          />
          <div className="flex items-start gap-1.5 min-w-0">
            <time
              className="shrink-0 w-[5.5rem] text-3xs font-mono tabular-nums text-fg-faint leading-snug"
              title={entry.at}
            >
              <RelativeTime value={entry.at} />
            </time>
            <span
              className={`shrink-0 inline-flex items-center rounded-sm px-1 py-px text-3xs font-semibold uppercase tracking-wide ${LANE_PILL[entry.lane]}`}
            >
              {LANE_LABEL[entry.lane]}
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-2xs font-medium text-fg leading-snug wrap-anywhere">
                {entry.title}
                {entry.status ? (
                  <span className="ml-1 text-fg-muted font-normal">· {entry.status}</span>
                ) : null}
              </div>
              {entry.body ? (
                <p className="text-3xs text-fg-secondary leading-snug wrap-anywhere mt-0.5">
                  {truncate(entry.body, 160)}
                </p>
              ) : null}
            </div>
          </div>
        </li>
      ))}
    </ol>
  )
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value
}
