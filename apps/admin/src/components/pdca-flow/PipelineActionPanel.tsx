/**
 * FILE: apps/admin/src/components/pdca-flow/PipelineActionPanel.tsx
 * PURPOSE: Top-right React Flow <Panel> exposing global pipeline actions:
 *          run judge now, flush queue, pause/resume auto-dispatch. Uses
 *          apiFetch directly; errors surface as toasts. Kept intentionally
 *          small — these are power-user escape hatches, not daily-driver
 *          buttons, so they're compact and secondary.
 */

import { useCallback, useState } from 'react'
import { apiFetch } from '../../lib/supabase'
import { useToast } from '../../lib/toast'
import { usePdcaFlow } from './PdcaFlowContext'

interface PipelineActionPanelProps {
  /** Optional override for the judge-run endpoint. */
  judgeRunEndpoint?: string
}

export function PipelineActionPanel({
  judgeRunEndpoint = '/v1/admin/judge/run',
}: PipelineActionPanelProps) {
  const toast = useToast()
  const flow = usePdcaFlow()
  const [judgeBusy, setJudgeBusy] = useState(false)

  const runJudge = useCallback(async () => {
    setJudgeBusy(true)
    try {
      const res = await apiFetch(judgeRunEndpoint, { method: 'POST' })
      if (res.ok) {
        toast.success('Judge run dispatched', 'Scores will refresh in a moment.')
      } else {
        toast.error('Judge run failed', res.error?.message ?? 'Please try again.')
      }
    } finally {
      setJudgeBusy(false)
    }
  }, [judgeRunEndpoint, toast])

  return (
    <div
      className="flex items-center gap-0.5 rounded-md border border-edge/70 bg-surface-overlay/90 shadow-card backdrop-blur-sm p-0.5"
      role="toolbar"
      aria-label="Pipeline actions"
    >
      <ActionBtn label="Run judge now" onClick={runJudge} busy={judgeBusy}>
        <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
          <path d="M8 2v12M3 7l5-5 5 5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </ActionBtn>
      {flow.onTogglePause && (
        <ActionBtn
          label={flow.paused ? 'Resume auto-dispatch' : 'Pause auto-dispatch'}
          onClick={flow.onTogglePause}
        >
          {flow.paused ? (
            <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <path d="M5 3l8 5-8 5V3z" />
            </svg>
          ) : (
            <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <rect x="4" y="3" width="3" height="10" rx="0.5" />
              <rect x="9" y="3" width="3" height="10" rx="0.5" />
            </svg>
          )}
        </ActionBtn>
      )}
    </div>
  )
}

interface ActionBtnProps {
  label: string
  onClick: () => void
  busy?: boolean
  children: React.ReactNode
}

function ActionBtn({ label, onClick, busy, children }: ActionBtnProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={busy}
      className="inline-flex h-6 w-6 items-center justify-center rounded-sm text-fg-muted hover:text-fg hover:bg-surface-overlay focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 disabled:opacity-40 disabled:cursor-not-allowed motion-safe:transition-colors"
    >
      {busy ? (
        <svg className="motion-safe:animate-spin" width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" opacity="0.3" />
          <path d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" fill="currentColor" />
        </svg>
      ) : (
        children
      )}
    </button>
  )
}
