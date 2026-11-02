/**
 * FILE: apps/admin/src/components/pipeline/TrainHistory.tsx
 * PURPOSE: Release trains (ADR 0044) of the last 7 days, one row per repo:
 *          a strip of squares, oldest left, green merged, red failed, blue
 *          on the way; the checks that failed them most; and "Run merge queue
 *          now" for the app. Clicking a square shows that train's detail.
 */

import { useState } from 'react'
import { Badge, Btn } from '../ui'
import { ageLabel, TRAIN_STATE_TONE, type ActionOutcome, type TrainSummary } from '../../lib/pipeline'

interface Props {
  trains: TrainSummary[]
  projectNames: Map<string, string>
  showApp: boolean
  now: number
  busyProjectId: string | null
  results: Map<string, ActionOutcome>
  onRetry: (projectId: string, repo: string) => void
}

const SQUARE: Record<string, string> = {
  merged: 'bg-ok',
  failed: 'bg-danger',
  building: 'bg-info',
  testing: 'bg-info',
  abandoned: 'bg-fg-faint',
}

export function TrainHistory({ trains, projectNames, showApp, now, busyProjectId, results, onRetry }: Props) {
  const [picked, setPicked] = useState<string | null>(null)
  if (trains.length === 0) {
    return <p className="text-xs text-fg-muted" data-testid="pipeline-trains-empty">No release train in the last 7 days.</p>
  }
  return (
    <ul className="space-y-3" data-testid="pipeline-trains">
      {trains.map((repo) => {
        const ordered = [...repo.trains].reverse()
        const chosen = repo.trains.find((t) => t.id === picked) ?? null
        const result = results.get(repo.repo)
        return (
          <li key={repo.repo} className="space-y-1.5" data-testid={`pipeline-train-${repo.repo}`}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                <span className="wrap-anywhere font-mono text-xs text-fg">{repo.repo}</span>
                {showApp && <Badge tone="neutral">{projectNames.get(repo.projectId) ?? 'app'}</Badge>}
                <span className="text-2xs tabular-nums text-fg-muted">
                  <span className="text-ok-foreground">{repo.merged} merged</span> ·{' '}
                  <span className={repo.failed > 0 ? 'font-medium text-danger-foreground' : ''}>{repo.failed} failed</span>
                  {repo.active > 0 && <> · <span className="text-info-foreground">{repo.active} on the way</span></>}
                </span>
              </span>
              <Btn
                size="sm"
                variant="ghost"
                loading={busyProjectId === repo.projectId}
                disabled={busyProjectId != null && busyProjectId !== repo.projectId}
                onClick={() => onRetry(repo.projectId, repo.repo)}
                data-testid={`pipeline-train-${repo.repo}-retry`}
              >
                Run merge queue now
              </Btn>
            </div>
            <div className="flex flex-wrap gap-0.5" role="list" aria-label={`Release trains for ${repo.repo}, oldest first`}>
              {ordered.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="listitem"
                  onClick={() => setPicked((cur) => (cur === t.id ? null : t.id))}
                  title={`${t.state} · ${t.members} fix${t.members === 1 ? '' : 'es'} · ${ageLabel(t.createdAt, now)} ago`}
                  aria-label={`Train ${t.prNumber ? `#${t.prNumber}` : ''} ${t.state}, ${ageLabel(t.createdAt, now)} ago`}
                  className={`h-3.5 w-3.5 rounded-xs ${SQUARE[t.state] ?? 'bg-fg-faint'} ${picked === t.id ? 'ring-2 ring-brand ring-offset-1 ring-offset-surface-raised' : 'hover:opacity-80'}`}
                />
              ))}
            </div>
            {chosen && (
              <p className="flex flex-wrap items-baseline gap-x-2 text-2xs text-fg-muted" data-testid="pipeline-train-detail">
                <Badge tone={TRAIN_STATE_TONE[chosen.state] ?? 'neutral'}>{chosen.state}</Badge>
                {chosen.prNumber ? (
                  <a href={`https://github.com/${repo.repo}/pull/${chosen.prNumber}`} target="_blank" rel="noreferrer" className="font-mono hover:text-fg hover:underline">
                    #{chosen.prNumber}
                  </a>
                ) : null}
                <span>
                  {chosen.members} fix{chosen.members === 1 ? '' : 'es'}
                  {chosen.attempt > 1 ? ` · retry ${chosen.attempt}` : ''} · {ageLabel(chosen.createdAt, now)} ago
                </span>
                {chosen.detail && <span className="wrap-break-word">{chosen.detail}</span>}
              </p>
            )}
            {repo.topFailures.length > 0 && (
              <p className="flex flex-wrap items-center gap-1 text-2xs text-fg-muted">
                <span>Fails most on:</span>
                {repo.topFailures.map((f) => (
                  <Badge key={f.check} tone="dangerSubtle">
                    {f.check} ×{f.count}
                  </Badge>
                ))}
              </p>
            )}
            {result && (
              <p className={`text-2xs ${result.ok ? 'text-ok-foreground' : 'text-warn-foreground'}`} role="status" data-testid={`pipeline-train-${repo.repo}-result`}>
                {result.message}
              </p>
            )}
          </li>
        )
      })}
    </ul>
  )
}
