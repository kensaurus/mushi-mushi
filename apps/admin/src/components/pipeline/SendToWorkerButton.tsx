/**
 * FILE: apps/admin/src/components/pipeline/SendToWorkerButton.tsx
 * PURPOSE: "Send to my local worker" (ADR 0048): put reports at the top of one
 *          of your own worker lanes for that app (PUT …/queue with front), so
 *          the lane fixes them next; one already queued moves up too.
 *          One lane → one click; several → pick one. Hidden when you have no
 *          lane for the app. Used on report detail and on pipeline groups.
 */

import { useState } from 'react'
import { Btn } from '../ui'
import { usePageData } from '../../lib/usePageData'
import { useToast } from '../../lib/toast'
import { LANES_PATH, myLanesFor, putQueue, QUEUE_REQUEST_MAX, type WorkerLane, type WorkLanesData } from '../../lib/workers'

interface Props {
  projectId: string
  reportIds: string[]
  /** The caller's lanes when it already read them (pipeline groups share one read); otherwise this reads them. */
  lanes?: WorkerLane[]
  size?: 'sm' | 'md'
  'data-testid'?: string
}

export function SendToWorkerButton({ projectId, reportIds, lanes: given, size = 'sm', 'data-testid': testId = 'send-to-worker' }: Props) {
  const page = usePageData<WorkLanesData>(given ? null : `${LANES_PATH}?projectId=${encodeURIComponent(projectId)}`, { scope: 'project' })
  const lanes = given ?? myLanesFor(page.data, projectId)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  const unique = [...new Set(reportIds)]
  const ids = unique.slice(0, QUEUE_REQUEST_MAX)
  const leftOut = unique.length - ids.length
  if (lanes.length === 0 || ids.length === 0) return null

  const send = async (lane: WorkerLane) => {
    setBusy(true)
    setOpen(false)
    const res = await putQueue(lane.id, ids, 'top')
    setBusy(false)
    if (!res.ok) return toast.error(res.message)
    const rest = leftOut > 0 ? ` Sent the first ${ids.length}; send the other ${leftOut} next.` : ''
    toast.success(`Lane ${lane.name}: ${res.message} It starts on them after what it is working on now.${rest}`)
  }
  const label = `Send to my local worker${ids.length > 1 ? ` (${ids.length})` : ''}`

  if (lanes.length === 1) {
    return (
      <Btn size={size} variant="ghost" loading={busy} onClick={() => void send(lanes[0]!)} title={`Fix next on lane ${lanes[0]!.name}: top of its queue`} data-testid={testId}>
        {label}
      </Btn>
    )
  }
  return (
    <span className="relative inline-flex">
      <Btn size={size} variant="ghost" loading={busy} aria-expanded={open} onClick={() => setOpen((v) => !v)} data-testid={testId}>
        {label}
      </Btn>
      {open && (
        <ul className="absolute left-0 top-full z-20 mt-1 min-w-48 rounded-md border border-edge-subtle bg-surface-raised p-1 shadow-card" role="menu" data-testid={`${testId}-menu`}>
          {lanes.map((l) => (
            <li key={l.id} role="none">
              <button
                type="button"
                role="menuitem"
                className="w-full rounded-sm px-2 py-1 text-left text-xs text-fg hover:bg-surface-overlay"
                onClick={() => void send(l)}
                data-testid={`${testId}-lane-${l.id}`}
              >
                {l.name}
                <span className="ml-1 text-2xs text-fg-muted">{l.config.model ?? 'default model'}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </span>
  )
}
