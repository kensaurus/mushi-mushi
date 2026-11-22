/**
 * FILE: apps/admin/src/components/prompt-lab/VersionStateMark.tsx
 * PURPOSE: One word and one mark for a prompt version's state, on AI prompts and on Triage
 *          grading → Prompts (2026-11-19: the same 0%-traffic version read "◆ Not started" in
 *          the Versions table, "Candidate" in the Fast filter table and "testing" on Prompts).
 *          With `detailed`, a running test says how many reports it gets in words
 *          ("Testing on half of reports") instead of "Traffic 50%".
 */

import { StatusGlyph, TONE_INK, type SignalTone } from '../signal/StatusGlyph'

type VersionFields = { is_active: boolean; is_candidate: boolean; traffic_percentage: number }

/** @internal Exported for tests. */
export function versionState(p: VersionFields): { label: string; tone: SignalTone } {
  if (p.is_active) return { label: 'In use', tone: 'ok' }
  if (p.is_candidate) return p.traffic_percentage > 0 ? { label: 'Testing', tone: 'info' } : { label: 'Not started', tone: 'warn' }
  return { label: 'Idle', tone: 'off' }
}

/** A share of reports in words: 50 → "half of reports", 10 → "1 in 10 reports", 100 → "all reports". */
export function trafficWords(pct: number): string {
  const p = Math.max(0, Math.min(100, Math.round(pct)))
  if (p === 0) return 'no reports'
  if (p === 100) return 'all reports'
  if (p === 50) return 'half of reports'
  if (p === 25) return 'a quarter of reports'
  if (p === 75) return 'three quarters of reports'
  if (100 % p === 0) return `1 in ${100 / p} reports`
  return `${p}% of reports`
}

/** @internal Exported for tests. The state with its share in words, for the version rows. */
export function versionStateWords(p: VersionFields): string {
  const s = versionState(p)
  if (s.label === 'Testing') return `Testing on ${trafficWords(p.traffic_percentage)}`
  return s.label
}

export function VersionStateMark({ version, detailed = false }: { version: VersionFields; detailed?: boolean }) {
  const s = versionState(version)
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap text-2xs ${detailed ? 'font-semibold' : ''} ${TONE_INK[s.tone]}`} data-testid="version-state">
      <StatusGlyph tone={s.tone} />
      {detailed ? versionStateWords(version) : s.label}
    </span>
  )
}
