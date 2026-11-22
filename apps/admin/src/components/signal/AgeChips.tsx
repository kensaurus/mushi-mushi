/**
 * FILE: apps/admin/src/components/signal/AgeChips.tsx
 * PURPOSE: Two small chips any page can use (2026-11-18, moved from ChecksPage into the kit):
 *   AgeCell    how old something is as a graded cell: neutral under a day, darker red as it
 *              ages, with ● ◆ ▲ so "14d" reads worse than "now" without colour.
 *   ChangeChip "▲ +3" / "▼ −2" since the last visit, red when worse, green when better.
 * The caller computes the age (e.g. lib/checkSignals `staleness`); these only draw it.
 */

import { TONE_CHAR, type SignalTone } from './StatusGlyph'

export interface AgeCellValue {
  /** "now", "5h", "3d", "14d". */
  short: string
  tone: SignalTone
  /** A scale class (`ci-cell-0`, `ci-fail-1..5`). */
  cellClass: string
}

export function AgeCell({ age, words, title, testId = 'age-cell' }: { age: AgeCellValue; words: string; title?: string; testId?: string }) {
  return (
    <span
      className={`${age.cellClass} ci-pop inline-flex shrink-0 items-center gap-0.5 rounded-sm px-1 font-mono text-3xs font-bold tabular-nums`}
      title={title ?? words}
      aria-label={words}
      data-testid={testId}
      data-tone={age.tone}
    >
      <span aria-hidden="true">{TONE_CHAR[age.tone]}</span>
      {age.short}
    </span>
  )
}

export function ChangeChip({ change, testId = 'change-chip' }: { change: { text: string; worse: boolean } | null; testId?: string }) {
  if (!change) return null
  return (
    <span
      className={`shrink-0 font-mono text-2xs font-bold tabular-nums ${change.worse ? 'text-danger-foreground' : 'text-ok-foreground'}`}
      title="Change since your last visit"
      data-testid={testId}
    >
      {change.text}
    </span>
  )
}
