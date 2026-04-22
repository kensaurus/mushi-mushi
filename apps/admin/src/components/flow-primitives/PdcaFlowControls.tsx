/**
 * FILE: apps/admin/src/components/flow-primitives/PdcaFlowControls.tsx
 * PURPOSE: Custom control-bar rendered inside a React Flow <Panel> — zoom
 *          in/out, fit-view, and a replay button. We don't use React Flow's
 *          default <Controls /> because it styles itself with colors that
 *          clash with the dark palette and includes controls we don't want
 *          (interactivity toggle, minimap). This component is minimal and
 *          theme-aware.
 */

import { useReactFlow } from '@xyflow/react'
import { useCallback } from 'react'

interface PdcaFlowControlsProps {
  /** When true, render a replay button that fires `onReplay`. */
  onReplay?: () => void
  /** When provided, renders a "Tidy" button that re-applies canonical layout. */
  onTidy?: () => void
  className?: string
}

export function PdcaFlowControls({ onReplay, onTidy, className = '' }: PdcaFlowControlsProps) {
  const rf = useReactFlow()

  const onZoomIn = useCallback(() => rf.zoomIn({ duration: 200 }), [rf])
  const onZoomOut = useCallback(() => rf.zoomOut({ duration: 200 }), [rf])
  const onFit = useCallback(() => rf.fitView({ duration: 300, padding: 0.2 }), [rf])

  return (
    <div
      className={[
        'flex items-center gap-0.5 rounded-md border border-edge/70 bg-surface-overlay/90 shadow-card p-0.5 backdrop-blur-sm',
        className,
      ].join(' ')}
      role="toolbar"
      aria-label="Flow controls"
    >
      <ControlBtn label="Zoom out" onClick={onZoomOut}>
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
          <line x1="4" y1="8" x2="12" y2="8" strokeLinecap="round" />
        </svg>
      </ControlBtn>
      <ControlBtn label="Zoom in" onClick={onZoomIn}>
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
          <line x1="4" y1="8" x2="12" y2="8" strokeLinecap="round" />
          <line x1="8" y1="4" x2="8" y2="12" strokeLinecap="round" />
        </svg>
      </ControlBtn>
      <ControlBtn label="Fit view" onClick={onFit}>
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
          <path d="M3 6V3h3M13 6V3h-3M3 10v3h3M13 10v3h-3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </ControlBtn>
      {onTidy && (
        <ControlBtn label="Tidy — re-apply layout and fit view" onClick={onTidy}>
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
            <rect x="2.5" y="2.5" width="4" height="4" rx="0.5" />
            <rect x="9.5" y="2.5" width="4" height="4" rx="0.5" />
            <rect x="2.5" y="9.5" width="4" height="4" rx="0.5" />
            <rect x="9.5" y="9.5" width="4" height="4" rx="0.5" />
          </svg>
        </ControlBtn>
      )}
      {onReplay && (
        <>
          <span className="h-4 w-px bg-edge/60" aria-hidden="true" />
          <ControlBtn label="Replay loop animation" onClick={onReplay}>
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
              <path d="M13 8a5 5 0 1 1-5-5 5 5 0 0 1 3.5 1.5" strokeLinecap="round" />
              <path d="M13 2v2.5H10.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </ControlBtn>
        </>
      )}
    </div>
  )
}

function ControlBtn({
  label,
  onClick,
  children,
}: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="inline-flex h-6 w-6 items-center justify-center rounded-sm text-fg-muted hover:text-fg hover:bg-surface-overlay focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 motion-safe:transition-colors"
    >
      {children}
    </button>
  )
}
