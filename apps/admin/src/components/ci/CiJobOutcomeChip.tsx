/**
 * FILE: apps/admin/src/components/ci/CiJobOutcomeChip.tsx
 * PURPOSE: One CI job's outcome as icon + word + colour (ciOutcome.tsx), so
 *          it never reads by colour alone and looks the same on every /ci
 *          surface.
 */

import type { CiJob } from '../../lib/ciTypes'
import { jobOutcome, type CiJobOutcome } from '../../lib/ciView'
import { CI_OUTCOME_STYLE } from './ciOutcome'

export function CiJobOutcomeChip({ job, outcome }: { job?: Pick<CiJob, 'status' | 'ciKind'>; outcome?: CiJobOutcome }) {
  const o = outcome ?? (job ? jobOutcome(job) : 'waiting')
  const s = CI_OUTCOME_STYLE[o]
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-sm px-1.5 py-0.5 text-3xs font-medium ${s.chip}`}>
      <s.Icon size={10} />
      {s.label}
    </span>
  )
}
