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
  return (
    <div className="rounded-md border border-edge/70 bg-surface-overlay/90 shadow-card backdrop-blur-sm p-2 text-2xs max-w-[14rem]">
      {focusMeta && (
        <div className="mb-1.5 flex items-center gap-1.5">
          <span
            className="relative inline-flex h-2 w-2 rounded-full"
            style={{ backgroundColor: STAGE_HEX[focusMeta.id as PdcaStageId] }}
            aria-hidden="true"
          >
            <span
              className="absolute inset-0 rounded-full motion-safe:animate-ping"
              style={{ backgroundColor: STAGE_HEX[focusMeta.id as PdcaStageId], opacity: 0.6 }}
            />
          </span>
          <span className="font-medium text-fg">
            {focusMeta.label} is the bottleneck
          </span>
        </div>
      )}
      {focusMeta && typeof focusCount === 'number' && focusCount > 0 && (
        <p className="mb-1.5 text-fg-muted leading-snug">
          <span className="font-mono text-fg">{focusCount}</span> {focusCountLabel ?? 'waiting here'}
        </p>
      )}
      <p className="mb-1 font-medium text-fg-muted uppercase tracking-wider text-[9px]">Legend</p>
      <ul className="space-y-0.5 text-fg-muted">
        {PDCA_ORDER.map((id) => {
          const meta = PDCA_STAGES[id]
          const isRunning = runningStage === id
          return (
            <li key={id} className="flex items-center gap-1.5">
              <span
                className="inline-block h-1.5 w-1.5 rounded-full shrink-0"
                style={{ backgroundColor: STAGE_HEX[id] }}
                aria-hidden="true"
              />
              <span className="font-mono text-fg-faint">{meta.letter}</span>
              <span className="truncate">{meta.label}</span>
              {isRunning && (
                <span className="ml-auto text-[9px] text-brand font-medium uppercase tracking-wider">
                  running
                </span>
              )}
            </li>
          )
        })}
      </ul>
      <p className="mt-1.5 pt-1.5 border-t border-edge/50 text-[10px] text-fg-faint leading-snug">
        Click a stage to inspect, dispatch, or undo.
      </p>
    </div>
  )
}
