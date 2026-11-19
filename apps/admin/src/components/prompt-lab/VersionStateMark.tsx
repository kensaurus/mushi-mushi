/**
 * FILE: apps/admin/src/components/prompt-lab/VersionStateMark.tsx
 * PURPOSE: One word and one mark for a prompt version's state, on AI prompts and on Triage
 *          grading → Prompts (2026-11-19: the same 0%-traffic version read "◆ Not started" in
 *          the Versions table, "Candidate" in the Fast filter table and "testing" on Prompts).
 */

import { StatusGlyph, TONE_INK, type SignalTone } from '../signal/StatusGlyph'

type VersionFields = { is_active: boolean; is_candidate: boolean; traffic_percentage: number }

/** @internal Exported for tests. */
export function versionState(p: VersionFields): { label: string; tone: SignalTone } {
  if (p.is_active) return { label: 'In use', tone: 'ok' }
  if (p.is_candidate) return p.traffic_percentage > 0 ? { label: 'Testing', tone: 'info' } : { label: 'Not started', tone: 'warn' }
  return { label: 'Idle', tone: 'off' }
}

export function VersionStateMark({ version }: { version: VersionFields }) {
  const s = versionState(version)
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap text-2xs ${TONE_INK[s.tone]}`} data-testid="version-state">
      <StatusGlyph tone={s.tone} />
      {s.label}
    </span>
  )
}
