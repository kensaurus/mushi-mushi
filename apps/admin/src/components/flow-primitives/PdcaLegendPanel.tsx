/**
 * FILE: apps/admin/src/components/flow-primitives/PdcaLegendPanel.tsx
 * PURPOSE: Top-left panel inside the PDCA React Flow canvas that explains
 *          what the colours + animations mean. Legibility is a big win
 *          here — users who never click a node still pick up the pipeline
 *          semantics at a glance.
 */

import { PDCA_STAGES, PDCA_ORDER } from '../../lib/pdca'
import type { PdcaStageId } from '../../lib/pdca'
import { STAGE_HEX } from './flowTokens'

interface PdcaLegendPanelProps {
  focusStage?: PdcaStageId | null
  runningStage?: PdcaStageId | null
  /** Count of reports currently blocked at the focus stage, surfaced as a
   *  single-line pipeline-health summary at the top of the legend. */
  focusCount?: number | null
  focusCountLabel?: string
}

export function PdcaLegendPanel({
  focusStage,
  runningStage,
  focusCount,
  focusCountLabel,
}: PdcaLegendPanelProps) {
  const focusMeta = focusStage ? PDCA_STAGES[focusStage] : null
  const runningMeta = runningStage ? PDCA_STAGES[runningStage] : null
  return (
    <div className="rounded-md border border-edge bg-surface-overlay/95 shadow-card backdrop-blur-sm px-2.5 py-2 text-2xs max-w-[16rem]">
      {focusMeta ? (
        <div className="flex items-center gap-1.5">
          <span
            className="relative inline-flex h-2 w-2 rounded-full shrink-0"
            style={{ backgroundColor: STAGE_HEX[focusMeta.id as PdcaStageId] }}
            aria-hidden="true"
          >
            <span
              className="absolute inset-0 rounded-full motion-safe:animate-ping"
              style={{ backgroundColor: STAGE_HEX[focusMeta.id as PdcaStageId], opacity: 0.6 }}
            />
          </span>
          <span className="font-medium text-fg truncate">
            {focusMeta.label} bottleneck
          </span>
          {typeof focusCount === 'number' && focusCount > 0 && (
            <span className="ml-auto font-mono text-fg shrink-0" title={focusCountLabel ?? 'waiting here'}>
              {focusCount}
            </span>
          )}
        </div>
      ) : (
        <div className="font-medium text-fg-muted">Pipeline clean</div>
      )}
      <div className="mt-1.5 flex items-center gap-1.5 text-3xs text-fg-muted border-t border-edge-subtle/60 pt-1.5">
        {PDCA_ORDER.map((id) => (
          <span
            key={id}
            className="inline-flex items-center gap-1 rounded-full border border-edge-subtle/70 bg-surface/60 px-1.5 py-0.5"
            aria-label={PDCA_STAGES[id].label}
          >
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ backgroundColor: STAGE_HEX[id] }}
              aria-hidden="true"
            />
            <span className="font-mono font-semibold">{PDCA_STAGES[id].letter}</span>
          </span>
        ))}
        {runningMeta && (
          <span className="ml-auto text-3xs text-brand font-medium uppercase tracking-wider">
            {runningMeta.letter} running
          </span>
        )}
      </div>
    </div>
  )
}
