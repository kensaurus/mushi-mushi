/**
 * FILE: apps/admin/src/components/prompt-lab/PromptScoreboard.tsx
 * PURPOSE: The top of AI prompts (console journeys 2026-10-27): one row per
 *          AI step with the version in use and its grade, the best version
 *          being tested and its grade, and whether the test is ahead. The
 *          editing table for a step opens from its row.
 */

import { STAGE_LABELS, type PromptVersion } from './types'

interface StageRow {
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
  if (c == null) return { text: `Test at ${row.candidate.traffic_percentage}% of traffic, waiting for grades`, tone: 'muted' }
  if (a == null) return { text: 'Test has grades, the version in use has none', tone: 'muted' }
  const diff = Math.round((c - a) * 100)
  if (diff > 0) return { text: `Test is ahead by ${diff} points: consider promoting it`, tone: 'ok' }
  if (diff < 0) return { text: `Test is behind by ${-diff} points`, tone: 'warn' }
  return { text: 'Test and version in use grade the same', tone: 'muted' }
}

const VERDICT_TONE = { ok: 'text-ok', warn: 'text-warn', muted: 'text-fg-muted' } as const

export function PromptScoreboard({
  stages,
  grouped,
  selected,
  onOpen,
}: {
  stages: readonly string[]
  grouped: Readonly<Record<string, PromptVersion[]>>
  selected: string | null
  onOpen: (stage: string) => void
}) {
  const rows = scoreboardRows(stages, grouped)
  if (rows.length === 0) return null
  return (
    <section aria-labelledby="prompt-scoreboard" className="min-w-0 space-y-2" data-testid="prompt-scoreboard">
      <h2 id="prompt-scoreboard" className="text-sm font-semibold text-fg">
        Versions and their grades
      </h2>
      <ul className="list-none divide-y divide-edge-subtle rounded-md border border-edge-subtle bg-surface-raised p-0">
        {rows.map((row) => {
          const verdict = stageVerdict(row)
          return (
            <li key={row.stage} className="min-w-0">
              {/* mushi-mushi-allowlist: intentional arbitrary layout (calc/fr/%/canvas) */}
              <button
                type="button"
                onClick={() => onOpen(row.stage)}
                aria-current={selected === row.stage ? 'true' : undefined}
                className={`grid w-full min-w-0 grid-cols-1 gap-x-4 gap-y-0.5 px-3 py-2 text-left text-xs hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand/50 sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.4fr)] ${selected === row.stage ? 'bg-surface-hover' : ''}`}
              >
                <span className="font-medium text-fg">{STAGE_LABELS[row.stage] ?? row.stage}</span>
                <span className="min-w-0 text-fg-secondary">
                  <span className="text-fg-faint">In use: </span>
                  {row.active ? (
                    <>
                      <span className="font-mono">{row.active.version}</span> · <span className="tabular-nums">{grade(row.active)}</span>
                    </>
                  ) : (
                    'none'
                  )}
                </span>
                <span className="min-w-0 text-fg-secondary">
                  <span className="text-fg-faint">Testing: </span>
                  {row.candidate ? (
                    <>
                      <span className="font-mono">{row.candidate.version}</span> · <span className="tabular-nums">{grade(row.candidate)}</span>
                    </>
                  ) : (
                    'none'
                  )}
                </span>
                <span className={VERDICT_TONE[verdict.tone]}>{verdict.text}</span>
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
