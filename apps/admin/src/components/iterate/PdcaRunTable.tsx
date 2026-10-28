/**
 * FILE: apps/admin/src/components/iterate/PdcaRunTable.tsx
 * PURPOSE: Runs list with status badges, progress, and row actions.
 */

import { Badge, Btn, EmptyState, RelativeTime } from '../ui'
import { IconChevronRight } from '../icons'
import { ScoreBar } from './ScoreBar'
import type { PdcaRun } from './types'
import { STATUS_CLS, STATUS_LABEL, personaLabel } from './types'

interface Props {
  runs: PdcaRun[]
  projectName: string | null
  onOpen: (run: PdcaRun) => void
  /** Asks for confirmation before aborting (the page owns the dialog). */
  onAbort: (id: string) => void
  onTrigger: (id: string) => void
  /** Run ids with a Trigger or Abort request in flight. */
  busyIds?: ReadonlySet<string>
}

function statusBadge(status: PdcaRun['status']) {
  return <Badge className={STATUS_CLS[status]}>{STATUS_LABEL[status]}</Badge>
}

export function PdcaRunTable({ runs, projectName, onOpen, onAbort, onTrigger, busyIds }: Props) {
  if (runs.length === 0) {
    return (
      <EmptyState
        title={projectName ? `No improvement runs for ${projectName} yet` : 'No improvement runs yet'}
        description="Start one on New Run: give the page address and who should review it. Each run lists its rounds, their scores and the reviewer's notes."
      />
    )
  }

  return (
    <div className="overflow-hidden rounded-md border border-edge">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-edge bg-surface-raised text-left text-fg-muted">
            <th className="px-3 py-2 font-medium">Target URL</th>
            <th className="px-3 py-2 font-medium">Status</th>
            <th className="px-3 py-2 font-medium">Progress</th>
            <th className="px-3 py-2 font-medium">Final score</th>
            <th className="px-3 py-2 font-medium">Persona</th>
            <th className="px-3 py-2 font-medium">Created</th>
            <th className="px-3 py-2 font-medium" />
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            <tr
              key={run.id}
              className="border-b border-edge/60 transition-opacity last:border-0 hover:bg-surface-raised/40"
            >
              {/* mushi-mushi-allowlist: intentional arbitrary layout (calc/fr/%/canvas) */}
              <td className="max-w-[24ch] truncate px-3 py-2 font-mono text-2xs" title={run.target_url}>
                {run.target_url}
              </td>
              <td className="px-3 py-2">{statusBadge(run.status)}</td>
              <td className="px-3 py-2 font-mono text-2xs tabular-nums text-fg-muted">
                {run.current_iteration}/{run.iterations_target}
              </td>
              <td className="px-3 py-2">
                <ScoreBar score={run.final_score} />
              </td>
              <td className="px-3 py-2 text-2xs text-fg-faint" title={run.persona}>{personaLabel(run.persona)}</td>
              <td className="px-3 py-2 text-2xs text-fg-muted">
                <RelativeTime value={run.created_at} />
              </td>
              <td className="px-3 py-2">
                <div className="flex items-center justify-end gap-1">
                  {run.status === 'queued' && (
                    <Btn size="sm" variant="ghost" onClick={() => onTrigger(run.id)} disabled={busyIds?.has(run.id)}>
                      Trigger
                    </Btn>
                  )}
                  {(run.status === 'queued' || run.status === 'running') && (
                    <Btn size="sm" variant="danger" onClick={() => onAbort(run.id)} disabled={busyIds?.has(run.id)}>
                      Abort
                    </Btn>
                  )}
                  <Btn size="sm" variant="ghost" onClick={() => onOpen(run)} aria-label="Open run detail">
                    <IconChevronRight className="h-3 w-3" />
                  </Btn>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
