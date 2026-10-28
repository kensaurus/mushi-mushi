/**
 * FILE: apps/admin/src/components/pipeline/SwitchCursorAccount.tsx
 * PURPOSE: "Switch account" for a local worker (ADR 0048 amendment
 *          2026-10-28): the machine's owner names the Cursor account its
 *          lanes may spend and signs the machine in as it, without a
 *          terminal. The machine finishes its runs, starts a Cursor sign-in
 *          and the link shows here; the owner approves it on cursor.com.
 *          No key or password is typed here or sent to the machine.
 *
 *          Every step says what is happening and what to do next: waiting
 *          for the machine (or it is offline), waiting for its runs, the
 *          sign-in link, signed in, the wrong account, expired, failed, and a
 *          CLI too old to switch from here.
 *
 * Data: GET/POST /v1/admin/work/hosts/:id/cursor-login|cursor-account (lib/workers.ts)
 */

import { useCallback, useEffect, useState } from 'react'
import { Modal } from '../Modal'
import { Badge, Btn, CodeValue, Input } from '../ui'
import { readCursorSwitch, switchCursorAccount, type CursorSwitchStatus } from '../../lib/workers'

interface Props {
  hostId: string
  hostname: string
  onClose: () => void
  /** The Workers tab reloads after a switch starts or ends. */
  onChanged?: () => void
  /** How often the dialog asks where the switch stands. */
  pollMs?: number
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$/
const OPEN: ReadonlySet<string> = new Set(['requested', 'waiting_for_runs', 'link_ready'])
const UPDATE_COMMAND = 'npm i -g @mushi-mushi/cli@latest'

export function SwitchCursorAccountDialog({ hostId, hostname, onClose, onChanged, pollMs = 3000 }: Props) {
  const [status, setStatus] = useState<CursorSwitchStatus | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [account, setAccount] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  /** The form shows again after Try again, even while the last switch's result is still the stored one. */
  const [editing, setEditing] = useState(false)

  const load = useCallback(async () => {
    const res = await readCursorSwitch(hostId)
    if (!res.ok) {
      setLoadError(res.message)
      return null
    }
    setLoadError(null)
    setStatus(res.data)
    return res.data
  }, [hostId])

  useEffect(() => {
    void load().then((s) => {
      if (s) setAccount((a) => a || s.account || '')
    })
  }, [load])

  const open = !!status?.login && OPEN.has(status.login.state)
  useEffect(() => {
    if (!open || editing) return
    const t = setInterval(() => {
      void load().then((s) => {
        if (s?.login && !OPEN.has(s.login.state)) onChanged?.()
      })
    }, pollMs)
    return () => clearInterval(t)
  }, [open, editing, load, pollMs, onChanged])

  const start = async (restart: boolean) => {
    const a = account.trim()
    if (!EMAIL_RE.test(a)) {
      setFormError('Give the e-mail address of the Cursor account this machine should use.')
      return
    }
    setBusy(true)
    const res = await switchCursorAccount(hostId, a, restart)
    setBusy(false)
    if (!res.ok) {
      setFormError(res.code === 'IN_PROGRESS' ? 'A switch is already under way on this machine. Start again to replace it.' : res.message)
      if (res.code === 'IN_PROGRESS') await load()
      return
    }
    setFormError(null)
    setEditing(false)
    await load()
    onChanged?.()
  }

  const login = status?.login ?? null
  const showForm = !!status?.canSwitch && (editing || !login)

  return (
    <Modal open onClose={onClose} title={`Switch the Cursor account on ${hostname}`} size="sm" dismissible={!busy}>
      <div className="space-y-3 text-2xs text-fg-secondary" data-testid="cursor-switch">
        {loadError && <p className="text-danger" data-testid="cursor-switch-error">{loadError}</p>}
        {!status && !loadError && <p>Reading the machine…</p>}

        {status && !status.canSwitch && (
          <div className="space-y-2" data-testid="cursor-switch-too-old">
            <p>
              This machine's Mushi CLI is too old to switch accounts from here. Update it there, then restart the worker:
            </p>
            <CodeValue value={UPDATE_COMMAND} />
            <p>Or sign in on the machine itself: <code>cursor-agent login</code>.</p>
          </div>
        )}

        {status && status.canSwitch && login && OPEN.has(login.state) && !editing && (
          <Progress status={status} hostname={hostname} onRestart={() => setEditing(true)} />
        )}

        {status && status.canSwitch && login && !OPEN.has(login.state) && !editing && (
          <Result status={status} onAgain={() => setEditing(true)} />
        )}

        {showForm && status && (
          <form
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault()
              void start(!!login && OPEN.has(login.state))
            }}
            data-testid="cursor-switch-form"
          >
            <p>
              The lanes on {hostname} will spend this account's Cursor credits. The machine finishes the runs in progress, then
              shows a Cursor sign-in link here; open it and approve as this account.
            </p>
            <Input
              id={`cursor-switch-${hostId}`}
              label="Cursor account (e-mail)"
              type="email"
              value={account}
              placeholder="e.g. you@example.com"
              onChange={(e) => {
                setAccount(e.target.value)
                if (formError) setFormError(null)
              }}
              data-testid="cursor-switch-account"
            />
            {formError && <p className="text-danger" data-testid="cursor-switch-form-error">{formError}</p>}
            {!status.online && (
              <p data-testid="cursor-switch-offline-note">{hostname} is offline. The switch starts when it checks in again.</p>
            )}
            <div className="flex justify-end gap-1.5">
              <Btn variant="ghost" type="button" onClick={onClose} disabled={busy}>
                Cancel
              </Btn>
              <Btn variant="primary" type="submit" loading={busy} data-testid="cursor-switch-start">
                {login && OPEN.has(login.state) ? 'Start again' : 'Start the switch'}
              </Btn>
            </div>
          </form>
        )}
      </div>
    </Modal>
  )
}

function Progress({ status, hostname, onRestart }: { status: CursorSwitchStatus; hostname: string; onRestart: () => void }) {
  const login = status.login!
  return (
    <div className="space-y-2" data-testid={`cursor-switch-${login.state}`}>
      <p>
        Switching to <strong className="text-fg">{login.account}</strong>.
      </p>
      {login.state === 'requested' &&
        (status.online ? (
          <p>Waiting for {hostname} to pick this up (within a minute or two).</p>
        ) : (
          <p data-testid="cursor-switch-offline">{hostname} is offline. It starts the switch when it checks in again; this page updates by itself.</p>
        ))}
      {login.state === 'waiting_for_runs' && (
        <p data-testid="cursor-switch-runs">
          Waiting for {status.runs ? `${status.runs} run${status.runs === 1 ? '' : 's'}` : 'the runs'} on {hostname} to finish. It takes
          nothing new meanwhile, and goes on after 30 minutes at most.
        </p>
      )}
      {login.state === 'link_ready' && login.url && (
        <div className="space-y-2">
          <p>Open the Cursor sign-in and approve it as {login.account}. The link works once and only for the next 15 minutes.</p>
          <Btn variant="primary" href={login.url} data-testid="cursor-switch-open-link">
            Open Cursor sign-in
          </Btn>
        </div>
      )}
      {login.detail && <p className="text-fg-muted">{login.detail}</p>}
      <div className="flex justify-end">
        <Btn size="sm" variant="ghost" onClick={onRestart} data-testid="cursor-switch-restart">
          Start again
        </Btn>
      </div>
    </div>
  )
}

function Result({ status, onAgain }: { status: CursorSwitchStatus; onAgain: () => void }) {
  const login = status.login!
  const ok = login.state === 'signed_in'
  const text: Record<string, string> = {
    signed_in: `Signed in as ${login.account}. The lanes take work again.`,
    wrong_account: `Signed in as the wrong account: the lanes take nothing until it is ${login.account}.`,
    expired: 'The switch expired before it finished.',
    failed: 'The switch did not work.',
  }
  return (
    <div className="space-y-2" data-testid={`cursor-switch-${login.state}`}>
      <p className="flex items-center gap-1.5">
        <Badge tone={ok ? 'ok' : 'danger'}>{ok ? 'done' : login.state === 'wrong_account' ? 'wrong account' : login.state}</Badge>
        <span>{text[login.state] ?? login.state}</span>
      </p>
      {login.detail && <p className="text-fg-muted">{login.detail}</p>}
      <div className="flex justify-end">
        <Btn size="sm" variant={ok ? 'ghost' : 'primary'} onClick={onAgain} data-testid="cursor-switch-again">
          {ok ? 'Switch to another account' : 'Try again'}
        </Btn>
      </div>
    </div>
  )
}
