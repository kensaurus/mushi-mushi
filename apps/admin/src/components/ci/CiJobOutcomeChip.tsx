/**
 * FILE: apps/admin/src/components/ci/CiJobOutcomeChip.tsx
 * PURPOSE: One CI job's outcome as glyph + word + tone, so it never reads by
 *          colour alone (passed ✓, failed ✕, test machine stopped ⚠, …).
 */

import { CHIP_TONE } from '../../lib/chipTone'
import type { CiJob } from '../../lib/ciTypes'
import { CI_OUTCOME_META, jobOutcome, type CiJobOutcome } from '../../lib/ciView'

const OUTCOME_CHIP: Record<CiJobOutcome, string> = {
  waiting: CHIP_TONE.neutral,
  running: CHIP_TONE.infoSubtle,
  passed: CHIP_TONE.okSubtle,
  code_failure: CHIP_TONE.dangerSubtle,
  infra: CHIP_TONE.warnSubtle,
  cancelled: CHIP_TONE.neutral,
  skipped: CHIP_TONE.neutral,
}

export function CiJobOutcomeChip({ job, outcome }: { job?: Pick<CiJob, 'status' | 'ciKind'>; outcome?: CiJobOutcome }) {
  const o = outcome ?? (job ? jobOutcome(job) : 'waiting')
  const meta = CI_OUTCOME_META[o]
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-sm px-1.5 py-0.5 text-3xs font-medium ${OUTCOME_CHIP[o]}`}>
      <span aria-hidden="true">{meta.glyph}</span>
      {meta.label}
    </span>
  )
}
