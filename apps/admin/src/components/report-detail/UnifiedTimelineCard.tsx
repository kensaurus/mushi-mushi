import { usePageData } from '../../lib/usePageData'
import { EmptyState, RelativeTime } from '../ui'
import type { UnifiedTimelineEntry, UnifiedTimelineLane } from './types'
import { CHIP_TONE } from '../../lib/chipTone'

const LANE_PILL: Record<UnifiedTimelineLane, string> = {
  report: 'bg-brand/12 text-brand border border-brand/28',
  reporter_comment: CHIP_TONE.info,
  admin_comment: CHIP_TONE.warn,
  fix: CHIP_TONE.ok,
  qa: CHIP_TONE.accent,
  skill_pipeline: 'bg-brand/12 text-brand border border-brand/28',
  ask_mushi: 'bg-surface-overlay text-fg-muted border border-edge-subtle',
  pipeline: CHIP_TONE.warn,
}

const LANE_LABEL: Record<UnifiedTimelineLane, string> = {
  report: 'report',
  reporter_comment: 'reporter',
  admin_comment: 'team',
  fix: 'fix',
  qa: 'qa',
  skill_pipeline: 'pipeline',
  ask_mushi: 'ask',
  pipeline: 'triage',
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
  // Only "Report submitted": its text repeats the description and the
  // header's "Reported …" (R2 sweep 2026-11-18, a big card with one line).
  if (timeline.length === 1 && timeline[0].lane === 'report') {
    return (
      <p className="text-xs text-fg-muted" data-testid="unified-timeline-only-report">
        Only the report so far. Comments, fix events, QA runs and pipeline steps appear here as they happen.
      </p>
    )
  }
  if (timeline.length === 0) {
    return (
      <EmptyState
        title="No unified timeline"
        description="Comments, fix events, QA runs, and pipeline steps will appear here as the report progresses."
      />
    )
  }

  return (
    // Scrollable, so it takes keyboard focus (axe scrollable-region-focusable).
    <ol
      tabIndex={0}
      aria-label="Unified timeline"
      className="relative ml-1 max-h-72 overflow-y-auto border-l border-edge-subtle pl-3 pr-1 space-y-1.5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand/40"
    >
      {timeline.map((entry) => (
        <li key={entry.id} className="relative py-0.5">
          <span
            aria-hidden
            // mushi-mushi-allowlist: intentional arbitrary layout (calc/fr/%/canvas)
            className="absolute -left-[14px] top-[0.45rem] size-1.5 rounded-full ring-2 ring-surface bg-brand"
          />
          <div className="flex items-start gap-1.5 min-w-0">
            <time
              // mushi-mushi-allowlist: intentional arbitrary layout (calc/fr/%/canvas)
              className="shrink-0 w-[5.5rem] text-3xs font-mono tabular-nums text-fg-faint leading-snug"
              title={entry.at}
            >
              <RelativeTime value={entry.at} />
            </time>
            <span
              className={`shrink-0 inline-flex items-center rounded-sm px-1 py-px text-3xs font-semibold ${LANE_PILL[entry.lane]}`}
            >
              {LANE_LABEL[entry.lane]}
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-2xs font-medium text-fg leading-snug wrap-anywhere">
                {entry.title}
                {/* A triage job's title already says its state ("Quick check failed"). */}
                {entry.status && entry.lane !== 'pipeline' ? (
                  <span className="ml-1 text-fg-muted font-normal">· {entry.status}</span>
                ) : null}
              </div>
              {entry.body ? (
                // A triage job's body is the plain line, then the raw error: the line shows, the raw text is the tooltip.
                <p className="text-3xs text-fg-secondary leading-snug wrap-anywhere mt-0.5" title={entry.lane === 'pipeline' ? entry.body : undefined}>
                  {truncate(entry.lane === 'pipeline' ? entry.body.split('\n')[0]! : entry.body, 160)}
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
