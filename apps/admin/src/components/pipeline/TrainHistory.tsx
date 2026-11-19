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

/** Letters and digits only, lower case: "Help Her Take Photo" and "help-her-take-photo" are one name. */
const plainName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

/**
 * The app badge beside a repo, only when it says something the repo slug does not
 * ("kensaurus/glot.it" + "glot.it" repeated the name on every row, round-2 review 2026-11-18).
 * @internal Exported for tests.
 */
export function appBadgeName(repo: string, appName: string | undefined): string | null {
  if (!appName) return null
  const base = repo.split('/').pop() ?? repo
  return plainName(base) === plainName(appName) ? null : appName
}

/**
 * Repos whose trains all merged (none failed, none on the way): with two or more they fold into one
 * line, "4 repos green: …", instead of four rows of "✓ N merged ○ 0 failed" (round-3 review,
 * 2026-11-19). A repo with a retry result stays a row. @internal Exported for tests.
 */
export function splitGreenTrains(trains: readonly TrainSummary[], results: ReadonlyMap<string, ActionOutcome>): { rows: TrainSummary[]; green: TrainSummary[] } {
  const green = trains.filter((t) => t.merged > 0 && t.failed === 0 && t.active === 0 && !results.has(t.repo))
  if (green.length < 2) return { rows: [...trains], green: [] }
  return { rows: trains.filter((t) => !green.includes(t)), green }
}

export function TrainHistory({ trains, projectNames, showApp, now, busyProjectId, results, onRetry }: Props) {
  const [picked, setPicked] = useState<string | null>(null)
  if (trains.length === 0) {
    return <p className="text-xs text-fg-muted" data-testid="pipeline-trains-empty">No release train in the last 7 days.</p>
  }
  const { rows, green } = splitGreenTrains(trains, results)
  const row = (repo: TrainSummary) => {
        const ordered = [...repo.trains].reverse()
        const chosen = repo.trains.find((t) => t.id === picked) ?? null
        const result = results.get(repo.repo)
        return (
          <li key={repo.repo} className="space-y-1.5" data-testid={`pipeline-train-${repo.repo}`}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                <span className="wrap-anywhere font-mono text-xs text-fg">{repo.repo}</span>
                {showApp && appBadgeName(repo.repo, projectNames.get(repo.projectId)) && <Badge tone="neutral">{appBadgeName(repo.repo, projectNames.get(repo.projectId))}</Badge>}
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
              {/* More than one repo: one "Run merge queue now" for all of them sits on the section
                  heading (it was the same button on all 7 rows, 2026-11-18). */}
              {trains.length === 1 && (
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
              )}
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
  }
  return (
    <ul className="space-y-3" data-testid="pipeline-trains">
      {rows.map(row)}
      {green.length > 0 && (
        <li data-testid="pipeline-trains-green">
          <details className="group">
            <summary className="flex cursor-pointer list-none flex-wrap items-baseline gap-x-2 text-2xs text-fg-muted hover:text-fg">
              <span className="inline-block transition-transform group-open:rotate-90" aria-hidden="true">▸</span>
              <span className="inline-flex items-center gap-1 font-medium text-ok-foreground">
                <StatusMark status="passed" size={10} />
                {green.length} repos green
              </span>
              <span className="min-w-0 wrap-anywhere" title="Trains merged in the last 7 days; none failed">
                {green.map((t) => `${t.repo.split('/').pop() ?? t.repo} ${t.merged}`).join(' · ')}
              </span>
            </summary>
            <ul className="mt-2 space-y-3 pl-4">{green.map(row)}</ul>
          </details>
        </li>
      )}
    </ul>
  )
}
