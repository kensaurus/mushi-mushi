/**
 * FILE: apps/admin/src/components/iterate/PdcaRunDrawer.tsx
 * PURPOSE: Run detail drawer with iteration timeline, critique panel, and export CTA.
 */

import { useEffect, useRef, useState } from 'react'
import { Badge, Btn, Card, RelativeTime } from '../ui'
import { Drawer } from '../Drawer'
import { ScoreBar } from './ScoreBar'
import type { PdcaIteration, PdcaRun } from './types'
import { STATUS_CLS, STATUS_LABEL, scoreBarClass } from './types'

interface Props {
  run: PdcaRun
  open: boolean
  onClose: () => void
  onAbort: (id: string) => void
  onTrigger: (id: string) => void
  onRefresh: () => void
}

function statusBadge(status: PdcaRun['status']) {
  return <Badge className={STATUS_CLS[status]}>{STATUS_LABEL[status]}</Badge>
}

export function PdcaRunDrawer({ run, open, onClose, onAbort, onTrigger, onRefresh }: Props) {
  const iterations = run.iterations ?? []
  const [activeIter, setActiveIter] = useState<PdcaIteration | null>(iterations.at(-1) ?? null)

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  useEffect(() => {
    if (run.status === 'running' || run.status === 'queued') {
      pollRef.current = setInterval(onRefresh, 3000)
    }
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
    }
  }, [run.status, onRefresh])

  useEffect(() => {
    if (iterations.length > 0) setActiveIter(iterations.at(-1)!)
  }, [iterations.length, iterations])

  const scores = iterations.map((i) => i.score ?? 0)

  return (
    <Drawer open={open} onClose={onClose} title={`Run: ${run.target_url}`} width="lg">
      <div className="space-y-5 pb-8">
        <div className="flex flex-wrap items-center gap-3">
          {statusBadge(run.status)}
          <span className="text-2xs text-fg-muted">
            {run.current_iteration}/{run.iterations_target} iterations
          </span>
          {run.final_score != null && (
            <span className="text-sm font-medium text-fg">
              Final: {Math.round(run.final_score * 100)}%
            </span>
          )}
          {run.status === 'queued' && (
            <Btn size="sm" variant="primary" onClick={() => onTrigger(run.id)}>
              Trigger now
            </Btn>
          )}
          {(run.status === 'queued' || run.status === 'running') && (
            <Btn size="sm" variant="danger" onClick={() => onAbort(run.id)}>
              Abort
            </Btn>
          )}
          {(run.status === 'running' || run.status === 'queued') && (
            <Btn size="sm" variant="ghost" onClick={onRefresh}>
              Refresh
            </Btn>
          )}
        </div>

        {scores.length > 0 && (
          <div>
            <p className="mb-2 text-3xs font-medium uppercase tracking-wide text-fg-muted">
              Score timeline
            </p>
            <div className="flex h-16 items-end gap-1">
              {scores.map((s, i) => {
                const h = Math.round(s * 100)
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setActiveIter(iterations[i])}
                    // mushi-mushi-allowlist: intentional arbitrary layout (calc/fr/%/canvas)
                    className={`min-w-[6px] flex-1 rounded-t-sm transition-opacity ${scoreBarClass(h)} ${
                      activeIter?.iteration_n === i + 1
                        ? 'opacity-100 ring-2 ring-brand'
                        : 'opacity-60 hover:opacity-100'
                    }`}
                    style={{ height: `${Math.max(h, 4)}%` }}
                    title={`Iteration ${i + 1}: ${h}%`}
                  />
                )
              })}
            </div>
            <div className="mt-1 flex justify-between text-3xs text-fg-faint">
              <span>Iter 1</span>
              <span>Iter {scores.length}</span>
            </div>
          </div>
        )}

        <div>
          <p className="mb-2 text-3xs font-medium uppercase tracking-wide text-fg-muted">
            Iterations
          </p>
          {iterations.length === 0 ? (
            <p className="text-2xs italic text-fg-muted">
              {run.status === 'queued'
                ? 'Waiting to start — click Trigger now to invoke the runner.'
                : 'No iterations recorded yet.'}
            </p>
          ) : (
            <div className="space-y-2">
              {iterations.map((iter) => (
                <button
                  key={iter.id}
                  type="button"
                  onClick={() => setActiveIter(iter)}
                  className={`flex w-full items-start gap-3 rounded-md border p-3 text-left transition-opacity hover:bg-surface-raised/40 ${
                    activeIter?.id === iter.id ? 'border-brand/40 bg-brand/5' : 'border-edge-subtle'
                  }`}
                >
                  <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-raised text-2xs font-bold text-fg-secondary">
                    {iter.iteration_n}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <ScoreBar score={iter.score} />
                      <span className="font-mono text-3xs text-fg-faint">
                        {(iter.ms_elapsed / 1000).toFixed(1)}s · ${iter.model_cost_usd.toFixed(4)}
                      </span>
                    </div>
                    {iter.critique_text && (
                      <p className="mt-1 line-clamp-2 text-2xs text-fg-muted">{iter.critique_text}</p>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {activeIter && (
          <div>
            <p className="mb-2 text-3xs font-medium uppercase tracking-wide text-fg-muted">
              Critique — iteration {activeIter.iteration_n}
            </p>
            <Card className="space-y-3 p-4">
              {activeIter.score != null && (
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium text-fg">Overall</span>
                  <ScoreBar score={activeIter.score} />
                </div>
              )}

              {Object.keys(activeIter.score_breakdown).length > 0 && (
                <div className="space-y-1">
                  {Object.entries(activeIter.score_breakdown).map(([dim, val]) => (
                    <div key={dim} className="flex items-center gap-2 text-2xs">
                      <span className="w-32 truncate capitalize text-fg-muted">
                        {dim.replace(/_/g, ' ')}
                      </span>
                      <ScoreBar score={val} />
                    </div>
                  ))}
                </div>
              )}

              {activeIter.critique_text && (
                <div className="rounded-md bg-surface-raised p-3">
                  <p className="text-sm leading-relaxed text-fg-secondary">{activeIter.critique_text}</p>
                </div>
              )}
            </Card>
          </div>
        )}

        <div className="space-y-1 rounded-md border border-edge-subtle bg-surface-raised/40 px-4 py-3 text-2xs text-fg-muted">
          <div className="flex gap-2">
            <span className="w-28 shrink-0">Goal</span>
            <span className="text-fg-secondary">{run.goal}</span>
          </div>
          <div className="flex gap-2">
            <span className="w-28 shrink-0">Producer</span>
            <span className="font-mono">{run.primary_model}</span>
          </div>
          <div className="flex gap-2">
            <span className="w-28 shrink-0">Judge</span>
            <span className="font-mono">{run.judge_model}</span>
          </div>
          <div className="flex gap-2">
            <span className="w-28 shrink-0">Persona</span>
            <span className="font-mono">{run.persona}</span>
          </div>
          <div className="flex gap-2">
            <span className="w-28 shrink-0">Target score</span>
            <span>{Math.round(run.target_score * 100)}%</span>
          </div>
          {run.started_at && (
            <div className="flex gap-2">
              <span className="w-28 shrink-0">Started</span>
              <RelativeTime value={run.started_at} />
            </div>
          )}
          {run.finished_at && (
            <div className="flex gap-2">
              <span className="w-28 shrink-0">Finished</span>
              <RelativeTime value={run.finished_at} />
            </div>
          )}
        </div>

        {run.status === 'succeeded' && iterations.length > 0 && (
          <div className="rounded-md border border-ok/30 bg-ok/5 px-4 py-3">
            <p className="text-sm font-medium text-ok">Run succeeded — export critique</p>
            <p className="mt-1 text-2xs text-fg-muted">
              Copy the full critique chain to paste into a GitHub PR description or Linear issue.
            </p>
            <Btn
              size="sm"
              variant="ghost"
              className="mt-2"
              onClick={() => {
                const text = iterations
                  .map(
                    (i) =>
                      `**Iteration ${i.iteration_n}** (score ${i.score?.toFixed(2) ?? '?'})\n${i.critique_text ?? ''}`,
                  )
                  .join('\n\n---\n\n')
                void navigator.clipboard.writeText(text)
              }}
            >
              Copy critique to clipboard
            </Btn>
          </div>
        )}
      </div>
    </Drawer>
  )
}
