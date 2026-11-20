/**
 * FILE: apps/admin/src/components/lessons/LessonRuleRows.tsx
 * PURPOSE: Rules in use as dense rows (console UX overhaul, 2026-11-19; they were tall cards):
 *
 *   ▲  Never call the payments API without an idempotency key…  [More]   ▇▇▇░ 12×   3d   Retire  ›
 *
 *   - severity is a glyph with its word on hover (critical ▲ red, warning ◆ amber, note ■ blue);
 *   - "seen N×" is a bar on one scale for the whole list, so the rule that fires most reads first;
 *   - the rule is clamped to 2 lines with "More" to expand in place; › opens the full detail.
 */

import { useState } from 'react'
import { Btn, RelativeTime } from '../ui'
import { IconChevronRight } from '../icons'
import { BarCell } from '../signal/BarCell'
import { StatusGlyph, type SignalTone } from '../signal/StatusGlyph'

export interface LessonRuleRow {
  id: string
  rule_text: string
  anti_pattern: string | null
  severity: 'info' | 'warn' | 'critical'
  frequency: number
  last_reinforced_at: string
  retired_at: string | null
}

/** @internal Exported for tests. A rule's severity as a glyph tone and a word. */
export function lessonSeverity(severity: string): { tone: SignalTone; word: string } {
  if (severity === 'critical') return { tone: 'danger', word: 'Critical' }
  if (severity === 'warn') return { tone: 'warn', word: 'Warning' }
  return { tone: 'info', word: 'Note' }
}

/** @internal Exported for tests. The shared top of the "seen N×" bars (at least 1). */
export function seenScale(rows: ReadonlyArray<{ frequency: number }>): number {
  return Math.max(1, ...rows.map((r) => (Number.isFinite(r.frequency) ? r.frequency : 0)))
}

export function LessonRuleRows<T extends LessonRuleRow>({
  rows,
  retiring,
  canEdit,
  onRetire,
  onOpen,
}: {
  rows: readonly T[]
  retiring: string | null
  canEdit: boolean
  onRetire: (row: T) => void
  onOpen: (row: T) => void
}) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())
  const max = seenScale(rows)
  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <ul className="list-none divide-y divide-edge-subtle rounded-md border border-edge p-0" data-testid="lesson-rule-rows">
      {rows.map((r) => {
        const sev = lessonSeverity(r.severity)
        const open = expanded.has(r.id)
        return (
          <li key={r.id} className="flex min-w-0 items-start gap-2 bg-surface px-2.5 py-1.5 hover:bg-surface-hover" data-testid="lesson-rule-row" data-severity={r.severity}>
            <span className="mt-0.5 shrink-0" title={sev.word}>
              <StatusGlyph tone={r.retired_at ? 'off' : sev.tone} label={sev.word} />
            </span>
            <div className="min-w-0 flex-1">
              <p className={`text-xs font-medium text-fg ${open ? 'whitespace-pre-line' : 'line-clamp-2'}`} data-testid="lesson-rule-text">
                {r.rule_text}
              </p>
              {open && r.anti_pattern ? <p className="mt-0.5 text-2xs text-fg-secondary">Avoid: {r.anti_pattern}</p> : null}
              {r.rule_text.length > 140 || r.anti_pattern ? (
                <button
                  type="button"
                  className="text-2xs font-medium text-fg-secondary underline decoration-dotted underline-offset-2 hover:text-fg"
                  aria-expanded={open}
                  onClick={() => toggle(r.id)}
                >
                  {open ? 'Less' : 'More'}
                </button>
              ) : null}
            </div>
            <span className="mt-0.5 hidden shrink-0 sm:inline-flex" title={`Seen ${r.frequency} ${r.frequency === 1 ? 'time' : 'times'}`}>
              <BarCell value={r.frequency} max={max} text={`${r.frequency}×`} tone="info" widthClass="w-14" />
            </span>
            {/* w-20 + nowrap: "4 weeks ago" wrapped onto three lines in w-10 (local check, 2026-11-19). */}
            <span className="mt-0.5 w-20 shrink-0 whitespace-nowrap text-right text-2xs text-fg-muted tabular-nums" title="Last seen">
              <RelativeTime value={r.last_reinforced_at} />
            </span>
            <Btn
              size="sm"
              variant="ghost"
              className="shrink-0"
              disabled={retiring === r.id || !canEdit}
              title={canEdit ? (r.retired_at ? 'Use this rule again' : 'Stop using this rule') : 'Viewers can read lessons but cannot change them.'}
              onClick={() => onRetire(r)}
            >
              {r.retired_at ? 'Restore' : 'Retire'}
            </Btn>
            <button
              type="button"
              className="mt-0.5 shrink-0 rounded-sm text-fg-muted hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
              aria-label="Open rule details"
              onClick={() => onOpen(r)}
            >
              <IconChevronRight className="h-4 w-4" />
            </button>
          </li>
        )
      })}
    </ul>
  )
}
