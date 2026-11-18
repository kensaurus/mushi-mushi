/**
 * FILE: apps/admin/src/components/pipeline/TrainHistory.tsx
 * PURPOSE: Release trains (ADR 0044) of the last 7 days, one row per repo:
 *          a strip of status marks, oldest left (✓ merged, ✕ failed, a
 *          pulsing ● on the way, ⊘ abandoned); the checks that failed them most; and "Run merge queue
 *          now" for the app. Clicking a square shows that train's detail.
 */

import { useState } from 'react'
import { Badge, Btn } from '../ui'
import { ageLabel, type ActionOutcome, type TrainSummary } from '../../lib/pipeline'
import { StatusMark, StatusPill, type RunStatus } from '../signal/StatusMark'

interface Props {
  trains: TrainSummary[]
  projectNames: Map<string, string>
  showApp: boolean
  now: number
  busyProjectId: string | null
  results: Map<string, ActionOutcome>
  onRetry: (projectId: string, repo: string) => void
}

/** A train's state as a mark: shape plus colour, so a red/green strip never relies on colour alone. */
const TRAIN_STATUS: Record<string, RunStatus> = {
  merged: 'passed',
  failed: 'failed',
  building: 'running',
  testing: 'running',
  abandoned: 'cancelled',
}
const trainStatus = (state: string): RunStatus => TRAIN_STATUS[state] ?? 'idle'

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
                <span className="inline-flex flex-wrap items-center gap-x-2 text-2xs tabular-nums text-fg-muted">
                  {/* Zero merged is not a pass: it takes the idle mark, never the green ✓ (2026-11-18). */}
                  <span className={`inline-flex items-center gap-1 ${repo.merged > 0 ? 'text-ok-foreground' : ''}`} data-testid={`pipeline-train-${repo.repo}-merged`}>
                    <StatusMark status={repo.merged > 0 ? 'passed' : 'idle'} size={10} />
                    {repo.merged} merged
                  </span>
                  <span className={`inline-flex items-center gap-1 ${repo.failed > 0 ? 'font-medium text-danger-foreground' : ''}`}>
                    <StatusMark status={repo.failed > 0 ? 'failed' : 'idle'} size={10} />
                    {repo.failed} failed
                  </span>
                  {repo.active > 0 && (
                    <span className="inline-flex items-center gap-1 text-info-foreground">
                      <StatusMark status="running" size={10} />
                      {repo.active} on the way
                    </span>
                  )}
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
                  data-status={trainStatus(t.state)}
                  className={`inline-flex h-4 w-4 items-center justify-center rounded-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${picked === t.id ? 'bg-surface-overlay ring-2 ring-brand' : 'hover:bg-surface-overlay'}`}
                >
                  <StatusMark status={trainStatus(t.state)} size={12} />
                </button>
              ))}
            </div>
            {chosen && (
              <p className="flex flex-wrap items-baseline gap-x-2 text-2xs text-fg-muted" data-testid="pipeline-train-detail">
                <StatusPill status={trainStatus(chosen.state)} label={chosen.state} />
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
                  <StatusPill key={f.check} status="failed" label={`${f.check} ×${f.count}`} />
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
