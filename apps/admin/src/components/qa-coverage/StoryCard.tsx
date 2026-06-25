import type { MouseEvent } from 'react'
import { Card, Btn, RelativeTime } from '../ui'
import { IconPlay, IconExternalLink, IconClock } from '../icons'
import {
  PROVIDER_BADGE,
  PROVIDER_LABEL,
  STATUS_BG,
  type QaStoryCoverage,
} from './qaStoryTypes'

export interface StoryCardProps {
  coverage: QaStoryCoverage
  isQueued: boolean
  onRunNow: (id: string) => void
  onSelect: (id: string) => void
  highlighted: boolean
}

export function StoryCard({
  coverage,
  isQueued,
  onRunNow,
  onSelect,
  highlighted,
}: StoryCardProps) {
  const passRate = coverage.pass_rate_pct
  const barTone =
    passRate === null
      ? 'bg-fg-faint/40'
      : passRate >= 80
        ? 'bg-ok'
        : passRate >= 50
          ? 'bg-warn'
          : 'bg-danger'
  const disabled = isQueued || !coverage.enabled

  return (
    <Card
      className={`group relative flex flex-col gap-3 p-4 cursor-pointer transition-[background-color,border-color,color,box-shadow,transform,opacity] hover:shadow-md ${highlighted ? 'ring-2 ring-brand' : ''}`}
      onClick={() => onSelect(coverage.story_id)}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-sm font-medium text-fg truncate leading-snug">{coverage.name}</span>
            {isQueued && (
              <span className="inline-flex items-center gap-1 text-3xs border px-1.5 py-0.5 rounded-full font-medium bg-brand/10 border-brand/20 text-brand">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-brand motion-safe:animate-pulse" />
                queued
              </span>
            )}
            {!coverage.enabled && !isQueued && (
              <span className="text-3xs text-fg-faint bg-surface-overlay border border-edge-subtle px-1.5 py-0.5 rounded-full">
                disabled
              </span>
            )}
          </div>
          <span
            className={`inline-block text-3xs border px-1.5 py-0.5 rounded-sm font-medium ${PROVIDER_BADGE[coverage.browser_provider] ?? 'bg-surface-overlay text-fg-secondary border-edge-subtle'}`}
          >
            {PROVIDER_LABEL[coverage.browser_provider] ?? coverage.browser_provider}
          </span>
        </div>

        <Btn
          size="sm"
          variant="ghost"
          loading={isQueued}
          disabled={disabled}
          onClick={(e: MouseEvent) => {
            e.stopPropagation()
            onRunNow(coverage.story_id)
          }}
          aria-label={isQueued ? 'Run queued…' : `Run ${coverage.name} now`}
          title={
            isQueued
              ? 'A run is already queued or in progress'
              : coverage.enabled
                ? 'Trigger manual run'
                : 'Story is disabled'
          }
        >
          {!isQueued && <IconPlay className="h-3 w-3" />}
        </Btn>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-2xs">
          <span className="text-fg-muted tabular-nums">
            {coverage.runs_24h === 0
              ? 'No runs in 24h'
              : `${coverage.runs_24h} run${coverage.runs_24h === 1 ? '' : 's'} · 24h`}
          </span>
          <div className="flex items-center gap-1.5">
            {coverage.last_run_status && (
              <span
                className={`text-3xs border px-1.5 py-0.5 rounded-sm font-medium ${STATUS_BG[coverage.last_run_status] ?? 'bg-surface-overlay border-edge-subtle text-fg-secondary'}`}
              >
                {coverage.last_run_status}
              </span>
            )}
            {passRate !== null ? (
              <span
                className={`font-medium tabular-nums ${passRate >= 80 ? 'text-ok' : passRate >= 50 ? 'text-warn' : 'text-danger'}`}
              >
                {passRate}%
              </span>
            ) : (
              <span className="text-fg-faint">—</span>
            )}
          </div>
        </div>
        <div className="h-1 w-full rounded-full bg-surface-overlay overflow-hidden">
          <div
            className={`h-full rounded-full transition-[background-color,border-color,color,box-shadow,transform,opacity] ${barTone}`}
            style={{ width: passRate !== null ? `${Math.max(2, Math.min(100, passRate))}%` : '0%' }}
          />
        </div>
      </div>

      <div className="flex items-center justify-between gap-2">
        {coverage.last_run_at ? (
          <div className="flex items-center gap-1 text-2xs text-fg-faint">
            <IconClock className="h-2.5 w-2.5 shrink-0" />
            <RelativeTime value={coverage.last_run_at} />
          </div>
        ) : (
          <span className="text-2xs text-fg-faint italic">never run</span>
        )}

        {coverage.last_failure_url && (
          <a
            href={coverage.last_failure_url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="flex items-center gap-0.5 text-2xs text-danger hover:underline"
          >
            <IconExternalLink className="h-2.5 w-2.5" />
            Replay
          </a>
        )}
      </div>
    </Card>
  )
}
