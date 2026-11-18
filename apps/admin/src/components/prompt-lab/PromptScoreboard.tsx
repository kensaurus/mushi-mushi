/**
 * FILE: apps/admin/src/components/prompt-lab/PromptScoreboard.tsx
 * PURPOSE: The top of AI prompts (console journeys 2026-10-27): one row per
 *          AI step with the version in use and its grade, the best version
 *          being tested and its grade, and whether the test is ahead. The
 *          editing table for a step opens from its row.
 */

import type { ReactNode } from 'react'
import { StatusGlyph } from '../signal/StatusGlyph'
import { STAGE_LABELS, type PromptVersion } from './types'

export interface StageRow {
  stage: string
  active: PromptVersion | null
  candidate: PromptVersion | null
}

/** @internal Exported for tests only. The active version and the best-graded candidate per step. */
export function scoreboardRows(stages: readonly string[], grouped: Readonly<Record<string, PromptVersion[]>>): StageRow[] {
  return stages.map((stage) => {
    const versions = grouped[stage] ?? []
    const active = versions.find((p) => p.is_active) ?? null
    const candidates = versions.filter((p) => !p.is_active && p.is_candidate)
    const candidate =
      [...candidates].sort((a, b) => (b.avg_judge_score ?? -1) - (a.avg_judge_score ?? -1) || b.total_evaluations - a.total_evaluations)[0] ?? null
    return { stage, active, candidate }
  })
}

function grade(p: PromptVersion | null): string {
  if (!p) return '—'
  return p.avg_judge_score != null ? `${Math.round(p.avg_judge_score * 100)}%` : 'no grades yet'
}

/** @internal Exported for tests only. One plain verdict per step. */
export function stageVerdict(row: StageRow): { text: string; tone: 'ok' | 'warn' | 'muted' } {
  if (!row.candidate) return { text: 'Nothing being tested', tone: 'muted' }
  const a = row.active?.avg_judge_score
  const c = row.candidate.avg_judge_score
  // A test at 0% of traffic is not running: no report reaches it, so no grade ever will.
  if (!(row.candidate.traffic_percentage > 0)) return { text: 'Not started: 0% of traffic', tone: 'warn' }
  if (c == null) return { text: `Test at ${row.candidate.traffic_percentage}% of traffic, waiting for grades`, tone: 'muted' }
  if (a == null) return { text: 'Test has grades, the version in use has none', tone: 'muted' }
  const diff = Math.round((c - a) * 100)
  if (diff > 0) return { text: `Test is ahead by ${diff} points: consider promoting it`, tone: 'ok' }
  if (diff < 0) return { text: `Test is behind by ${-diff} points`, tone: 'warn' }
  return { text: 'Test and version in use grade the same', tone: 'muted' }
}

const VERDICT_TONE = { ok: 'text-ok-foreground', warn: 'text-warn-foreground', muted: 'text-fg-muted' } as const

/**
 * @internal Exported for tests only. Steps with nothing under test and no grades on the
 * version in use say the same thing row after row (2026-11-18: ten identical rows), so
 * they fold into one group; steps under test, or graded, stay as their own rows.
 */
export function splitScoreboardRows(rows: readonly StageRow[]): { shown: StageRow[]; baselineOnly: StageRow[] } {
  const shown: StageRow[] = []
  const baselineOnly: StageRow[] = []
  for (const row of rows) {
    if (!row.candidate && row.active?.avg_judge_score == null) baselineOnly.push(row)
    else shown.push(row)
  }
  // Steps under test first, then graded ones.
  shown.sort((a, b) => Number(Boolean(b.candidate)) - Number(Boolean(a.candidate)))
  // A lone baseline row is not worth a group.
  if (baselineOnly.length === 1) return { shown: [...shown, ...baselineOnly], baselineOnly: [] }
  return { shown, baselineOnly }
}

// mushi-mushi-allowlist: intentional arbitrary layout (calc/fr/%/canvas): four aligned columns from sm up
const ROW_GRID = 'grid w-full min-w-0 grid-cols-1 gap-x-4 gap-y-0.5 px-3 py-2 text-left text-xs sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.4fr)]'

function ScoreRow({ row, selected, onOpen }: { row: StageRow; selected: string | null; onOpen: (stage: string) => void }) {
  const verdict = stageVerdict(row)
  return (
    <li className="min-w-0">
      <button
        type="button"
        onClick={() => onOpen(row.stage)}
        aria-current={selected === row.stage ? 'true' : undefined}
        className={`${ROW_GRID} hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand/50 ${selected === row.stage ? 'bg-surface-hover' : ''}`}
      >
        <span className="font-medium text-fg">{STAGE_LABELS[row.stage] ?? row.stage}</span>
        <span className="min-w-0 text-fg-secondary">
          <span className="text-fg-faint sm:sr-only">In use: </span>
          {row.active ? (
            <>
              <span className="font-mono">{row.active.version}</span> · <span className="tabular-nums">{grade(row.active)}</span>
            </>
          ) : (
            'none'
          )}
        </span>
        <span className="min-w-0 text-fg-secondary">
          <span className="text-fg-faint sm:sr-only">Testing: </span>
          {row.candidate ? (
            <>
              <span className="font-mono">{row.candidate.version}</span> · <span className="tabular-nums">{grade(row.candidate)}</span>
            </>
          ) : (
            'none'
          )}
        </span>
        <span className={`inline-flex items-center gap-1 ${VERDICT_TONE[verdict.tone]}`}>
          {verdict.tone !== 'muted' && <StatusGlyph tone={verdict.tone} />}
          {verdict.text}
        </span>
      </button>
    </li>
  )
}

export function PromptScoreboard({
  stages,
  grouped,
  selected,
  onOpen,
  headingExtra,
}: {
  stages: readonly string[]
  grouped: Readonly<Record<string, PromptVersion[]>>
  selected: string | null
  onOpen: (stage: string) => void
  /** Help beside the heading (the stage tab strip that used to carry it is gone). */
  headingExtra?: ReactNode
}) {
  const rows = scoreboardRows(stages, grouped)
  if (rows.length === 0) return null
  const { shown, baselineOnly } = splitScoreboardRows(rows)
  return (
    <section aria-labelledby="prompt-scoreboard" className="min-w-0 space-y-2" data-testid="prompt-scoreboard">
      <div className="flex items-center gap-1.5">
        <h2 id="prompt-scoreboard" className="text-sm font-semibold text-fg">
          Versions and their grades
        </h2>
        {headingExtra}
      </div>
      <div className="min-w-0 rounded-md border border-edge-subtle bg-surface-raised">
        <div aria-hidden className={`${ROW_GRID} hidden border-b border-edge-subtle font-medium text-fg-muted sm:grid`} data-testid="prompt-scoreboard-head">
          <span>Prompt</span>
          <span>In use</span>
          <span>Testing</span>
          <span>Status</span>
        </div>
        <ul className="list-none divide-y divide-edge-subtle p-0">
          {shown.map((row) => (
            <ScoreRow key={row.stage} row={row} selected={selected} onOpen={onOpen} />
          ))}
        </ul>
        {baselineOnly.length > 0 && (
          <details
            className="group border-t border-edge-subtle"
            data-testid="prompt-scoreboard-baseline"
            open={baselineOnly.some((r) => r.stage === selected) || undefined}
          >
            <summary className={`${ROW_GRID} cursor-pointer list-none text-fg-secondary hover:bg-surface-hover`}>
              <span className="font-medium text-fg">{baselineOnly.length} prompts</span>
              <span>In use only, no grades yet</span>
              <span className="text-fg-faint">Nothing being tested</span>
              <span className="text-fg-muted group-open:hidden">Show</span>
              <span className="hidden text-fg-muted group-open:inline">Hide</span>
            </summary>
            <ul className="list-none divide-y divide-edge-subtle border-t border-edge-subtle p-0">
              {baselineOnly.map((row) => (
                <ScoreRow key={row.stage} row={row} selected={selected} onOpen={onOpen} />
              ))}
            </ul>
          </details>
        )}
      </div>
    </section>
  )
}
