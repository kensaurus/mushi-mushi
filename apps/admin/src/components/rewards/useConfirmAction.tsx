/**
 * FILE: apps/admin/src/components/rewards/useConfirmAction.tsx
 * PURPOSE: One-line ConfirmDialog for the Rewards panels' destructive and
 *          money-moving buttons (remove webhook / identity provider, delete
 *          quest, deny dispute), which used to fire on a single click.
 *
 * USAGE:
 *   const confirm = useConfirmAction()
 *   <Btn onClick={() => confirm.ask({ title, body, confirmLabel, run: () => remove(id) })} />
 *   {confirm.dialog}
 */

import { useCallback, useState, type ReactNode } from 'react'
import { ConfirmDialog } from '../ConfirmDialog'

export interface ConfirmActionRequest {
  title: string
  body: string
  confirmLabel: string
  /** Defaults to 'danger'. */
  tone?: 'default' | 'danger'
  run: () => void | Promise<void>
}

export function useConfirmAction(): { ask: (req: ConfirmActionRequest) => void; dialog: ReactNode } {
  const [pending, setPending] = useState<ConfirmActionRequest | null>(null)
  const [running, setRunning] = useState(false)

  const ask = useCallback((req: ConfirmActionRequest) => setPending(req), [])

  const dialog = pending ? (
    <ConfirmDialog
      title={pending.title}
      body={pending.body}
      confirmLabel={pending.confirmLabel}
      tone={pending.tone ?? 'danger'}
      loading={running}
      onCancel={() => setPending(null)}
      onConfirm={async () => {
        setRunning(true)
        try {
          await pending.run()
        } finally {
          setRunning(false)
          setPending(null)
        }
      }}
    />
  ) : null

  return { ask, dialog }
}
