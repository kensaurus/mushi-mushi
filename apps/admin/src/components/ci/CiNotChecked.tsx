/**
 * FILE: apps/admin/src/components/ci/CiNotChecked.tsx
 * PURPOSE: What a /ci panel shows when its read did not answer in time (lib/ciReadTimeout.ts):
 *          a hatched "not checked" row with the off mark and one Retry, never an endless spinner
 *          and never a zero.
 */

import { Btn } from '../ui'
import { StatusGlyph } from '../signal/StatusGlyph'

export function CiNotChecked({ what, onRetry, testId }: { what: string; onRetry: () => void; testId?: string }) {
  return (
    <div className="ci-nodata flex flex-wrap items-center gap-2 rounded-sm border border-edge-subtle px-2.5 py-1.5 text-xs" role="status" data-testid={testId}>
      <StatusGlyph tone="off" />
      <span className="font-semibold text-fg">{what}: not checked</span>
      <span className="text-2xs text-fg-secondary">No answer in time.</span>
      <Btn size="sm" variant="ghost" className="ml-auto whitespace-nowrap" onClick={onRetry}>
        Retry
      </Btn>
    </div>
  )
}
