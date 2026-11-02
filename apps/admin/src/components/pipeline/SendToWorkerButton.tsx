/**
 * FILE: apps/admin/src/components/pipeline/SendToWorkerButton.tsx
 * PURPOSE: "Send to my local worker" (ADR 0048): put reports at the end of one
 *          of your own worker lanes for that app (PUT …/queue with append).
 *          One lane → one click; several → pick one. Hidden when you have no
 *          lane for the app. Used on report detail and on pipeline groups.
 */

import { useState } from 'react'
import { Btn } from '../ui'
import { usePageData } from '../../lib/usePageData'
import { useToast } from '../../lib/toast'
import { LANES_PATH, myLanesFor, putQueue, type WorkerLane, type WorkLanesData } from '../../lib/workers'

/** A lane holds at most this many queued reports (the server's QUEUE_MAX). */
const MAX_SEND = 50

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
  const ids = [...new Set(reportIds)].slice(0, MAX_SEND)
  if (lanes.length === 0 || ids.length === 0) return null

  const send = async (lane: WorkerLane) => {
    setBusy(true)
    setOpen(false)
    const res = await putQueue(lane.id, ids, true)
    setBusy(false)
    if (res.ok) toast.success(`${res.message.replace("the lane's queue", `lane ${lane.name}`)} It takes them after what it is working on.`)
    else toast.error(res.message)
  }
  const label = `Send to my local worker${ids.length > 1 ? ` (${ids.length})` : ''}`

  if (lanes.length === 1) {
    return (
      <Btn size={size} variant="ghost" loading={busy} onClick={() => void send(lanes[0]!)} title={`Queue on lane ${lanes[0]!.name}`} data-testid={testId}>
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
