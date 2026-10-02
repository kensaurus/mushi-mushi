/**
 * FILE: apps/admin/src/components/design/DevianceScoreCard.tsx
 * PURPOSE: The deviance score (0 = on-system, 100 = off-system; lower is
 *          better) for the latest scan. `score: null` renders "Not scored"
 *          with the reason — never 0, which would read as a perfect result.
 */

import { Badge, Card, formatRelative } from '../ui'
import type { DevianceRun } from '../../lib/recipeTypes'
import { RecipeStateGlyph } from '../recipe/RecipeStateChip'

function RunStatusBadge({ status }: { status: unknown }) {
  switch (status) {
    case 'pass':
      return (
        <Badge tone="okSubtle" className="gap-1">
          <RecipeStateGlyph glyph="check" />
          Pass
        </Badge>
      )
    case 'warn':
      return (
        <Badge tone="warnSubtle" className="gap-1">
          <RecipeStateGlyph glyph="triangle" />
          Warn
        </Badge>
      )
    case 'fail':
      return (
        <Badge tone="dangerSubtle" className="gap-1">
          <RecipeStateGlyph glyph="cross" />
          Fail
        </Badge>
      )
    case 'error':
      return (
        <Badge tone="dangerSubtle" className="gap-1">
          <RecipeStateGlyph glyph="cross" />
          Scan error
        </Badge>
      )
    case 'running':
      return <Badge tone="info">Running</Badge>
    default:
      return (
        <Badge tone="neutral" className="gap-1">
          <RecipeStateGlyph glyph="question" />
          Unknown
        </Badge>
      )
  }
}

function notScoredReason(run: DevianceRun | null): string {
  if (!run) return 'No deviance scan has run for this project yet.'
  if (run.error) return run.error
  if (run.status === 'running') return 'The scan is still running.'
  if (run.scannedFiles === 0) return 'The scan matched no files, so there was nothing to judge.'
  return 'No enabled rule had anything to judge.'
}

export function DevianceScoreCard({ run }: { run: DevianceRun | null }) {
  const score = run ? run.score : null
  const scored = typeof score === 'number' && Number.isFinite(score)
  const completed = run?.completedAt ? new Date(run.completedAt) : null
  const completedText = completed && !Number.isNaN(completed.getTime()) ? formatRelative(completed) : null

  return (
    <Card className="flex flex-col gap-3 p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-2xs uppercase tracking-wider text-fg-faint">Deviance score</span>
          {scored ? (
            <span className="flex items-baseline gap-1" data-testid="deviance-score">
              <span className="text-3xl font-semibold tabular-nums text-fg">{Math.round(score)}</span>
              <span className="text-xs text-fg-muted">/ 100 · lower is better</span>
            </span>
          ) : (
            <span className="flex flex-col gap-0.5" data-testid="deviance-score">
              <span className="text-lg font-semibold text-fg-secondary">Not scored</span>
              <span className="text-xs text-fg-muted">{notScoredReason(run)}</span>
            </span>
          )}
        </div>
        <div className="flex flex-col items-end gap-1">
          <RunStatusBadge status={run?.status} />
          {completedText && <span className="text-2xs text-fg-faint">Scanned {completedText}</span>}
          {run?.commitSha && (
            <span className="font-mono text-2xs text-fg-faint" title={run.commitSha}>
              @ {run.commitSha.slice(0, 7)}
            </span>
          )}
        </div>
      </div>
      {run && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-2xs text-fg-secondary">
          <span>
            {run.scannedFiles.toLocaleString()} of {run.matchedFiles.toLocaleString()} matched files scanned
          </span>
          <span>{run.scannedLines.toLocaleString()} lines</span>
          <span>{run.storedFindings.toLocaleString()} findings stored</span>
        </div>
      )}
      {run?.truncated && (
        <p className="text-xs text-fg-secondary" role="note">
          <span className="font-medium">Partial scan:</span> the file or size cap stopped it early, so the score covers
          only the files scanned.
        </p>
      )}
    </Card>
  )
}
