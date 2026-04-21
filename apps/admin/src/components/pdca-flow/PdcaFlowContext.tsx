/**
 * FILE: apps/admin/src/components/pdca-flow/PdcaFlowContext.tsx
 * PURPOSE: Light context shared by every child of a `<PdcaFlow>` so custom
 *          nodes and edges can read the current focus/running stage and
 *          open the side drawer without prop-drilling through React Flow's
 *          opaque rendering pipeline.
 *
 *          Deliberately tiny — no stores, no reducers. If the flow grows
 *          richer state (history, undo, multi-selection) we'll migrate to
 *          zustand, but for the current interaction budget a context is
 *          the right zero-dep primitive.
 */

import { createContext, useContext } from 'react'
import type { PdcaStageId } from '../../lib/pdca'

export type PdcaFlowVariant = 'live' | 'onboarding'

export interface PdcaFlowContextValue {
  variant: PdcaFlowVariant
  focusStage: PdcaStageId | null
  /** Set when a stage is actively processing (dispatch running, judge running,
   *  etc.). Drives the running-glow and traveling-dots edge effect. */
  runningStage: PdcaStageId | null
  /** Persist-through-reload stage currently targeted by deep-link `#stage=do`. */
  openStage: PdcaStageId | null
  onOpenStage: (stage: PdcaStageId | null) => void
  /** Optional: invoked by the replay button in <PdcaFlowControls />. */
  onReplay?: () => void
  /** Optional: invoked when the user asks to pause/resume auto-dispatch
   *  from the top-right pipeline action panel. */
  onTogglePause?: () => void
  /** Last-known pause state (so UI can surface the right label). */
  paused?: boolean
}

export const PdcaFlowContext = createContext<PdcaFlowContextValue | null>(null)

export function usePdcaFlow(): PdcaFlowContextValue {
  const ctx = useContext(PdcaFlowContext)
  if (!ctx) {
    return {
      variant: 'live',
      focusStage: null,
      runningStage: null,
      openStage: null,
      onOpenStage: () => {},
    }
  }
  return ctx
}
