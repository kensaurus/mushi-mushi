/**
 * ActionsCard — store actions waiting for a person (Plan 020 Phase 4,
 * ADR 0017). An editor agent or a teammate can ask; only an owner or admin
 * signed in here can approve, and then run, each one. The approval covers
 * the exact payload shown and expires after an hour; a run happens once.
 *
 * Data: GET  /v1/admin/orgs/:orgId/connector-actions
 *       POST /v1/admin/orgs/:orgId/connector-actions               (ask)
 *       POST /v1/admin/orgs/:orgId/connector-actions/:id/approve|reject|execute
 */

import { useState } from 'react'
import { Badge, Btn, Callout, DisclosurePanel, Loading, Section, SelectField, Textarea, type BadgeTone } from '../ui'
import { usePageData } from '../../lib/usePageData'
import { apiFetchMutate } from '../../lib/supabase'
import { actionErrorText } from '../../lib/actionErrorText'
import { ConfirmDialog } from '../ConfirmDialog'
import { PageLoadError } from '../PageLoadError'

interface ActionRow {
  id: string
  connector_instance_id: string
  action: string
  payload: Record<string, unknown>
  payload_sha256: string
  reason: string | null
  status: 'pending_approval' | 'approved' | 'rejected' | 'executing' | 'executed' | 'failed' | 'expired'
  requested_by: string
  requested_at: string
  expires_at: string | null
  error: string | null
}

const STATUS: Record<ActionRow['status'], { label: string; tone: BadgeTone }> = {
  pending_approval: { label: 'Waiting for approval', tone: 'warnSubtle' },
  approved: { label: 'Approved, not run', tone: 'infoSubtle' },
  rejected: { label: 'Rejected', tone: 'neutral' },
  executing: { label: 'Running', tone: 'infoSubtle' },
  executed: { label: 'Done', tone: 'okSubtle' },
  failed: { label: 'Failed', tone: 'dangerSubtle' },
  expired: { label: 'Expired', tone: 'neutral' },
}

export function ActionsCard({ orgId, connectors }: { orgId: string; connectors: Array<{ id: string; name: string; actions: string[] }> }) {
  const path = `/v1/admin/orgs/${orgId}/connector-actions`
  const { data, loading, error, reload } = usePageData<{ actions: ActionRow[] }>(path)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ tone: 'info' | 'danger'; text: string } | null>(null)
  const [connectorId, setConnectorId] = useState('')
  const [action, setAction] = useState('')
  const [payload, setPayload] = useState('{\n  "package": "",\n  "track": "production",\n  "userFraction": 0.1,\n  "versionCodes": [""]\n}')
  const actable = connectors.filter((c) => c.actions.length > 0)
  const chosen = actable.find((c) => c.id === connectorId)
  // Reject ends a request, and Run now changes the live store listing: both
  // ask first (QA 44).
  const [confirm, setConfirm] = useState<{ row: ActionRow; kind: 'reject' | 'execute' } | null>(null)

  const run = async (url: string, body: unknown, okText: string) => {
    setBusy(true)
    setNotice(null)
    try {
      const res = await apiFetchMutate(url, { method: 'POST', body: JSON.stringify(body ?? {}) })
      setNotice(res.ok ? { tone: 'info', text: okText } : { tone: 'danger', text: actionErrorText(res.error, 'That did not work. Try again in a minute.') })
    } finally {
      setBusy(false)
      reload()
    }
  }

  const ask = () => {
    let parsed: unknown
    try {
      parsed = JSON.parse(payload)
    } catch {
      setNotice({ tone: 'danger', text: 'The payload is not valid JSON.' })
      return
    }
    void run(path, { connectorId, action, payload: parsed }, 'Asked. An owner or admin approves it below before anything runs.')
  }

  if (actable.length === 0 && (data?.actions.length ?? 0) === 0) return null
  return (
    <Section title="Store actions">
      <p className="mb-3 text-xs text-fg-muted">Nothing here runs on its own. Each action needs your approval, covers exactly the payload shown, expires after an hour, and runs once.</p>
      {error && <PageLoadError error={error} resource="store actions" endpoint={path} onRetry={reload} />}
      {loading && !data && <Loading text="Reading actions…" />}
      {notice && (
        <Callout tone={notice.tone}>
          <span role="status">{notice.text}</span>
        </Callout>
      )}
      {data && data.actions.length > 0 && (
        <ul className="flex flex-col divide-y divide-edge-subtle">
          {data.actions.map((a) => {
            const st = STATUS[a.status] ?? STATUS.pending_approval
            return (
              <li key={a.id} className="flex flex-col gap-1 py-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-medium text-fg">{a.action} <Badge tone={st.tone} className="ml-1">{st.label}</Badge></span>
                  <div className="flex gap-2">
                    {a.status === 'pending_approval' && <Btn size="sm" disabled={busy} onClick={() => run(`${path}/${a.id}/approve`, { payloadSha256: a.payload_sha256 }, 'Approved for one hour. Run it when ready.')}>Approve</Btn>}
                    {a.status === 'approved' && <Btn size="sm" disabled={busy} onClick={() => setConfirm({ row: a, kind: 'execute' })}>Run now</Btn>}
                    {(a.status === 'pending_approval' || a.status === 'approved') && <Btn size="sm" variant="ghost" disabled={busy} onClick={() => setConfirm({ row: a, kind: 'reject' })}>Reject</Btn>}
                  </div>
                </div>
                <p className="text-2xs text-fg-faint">Asked by {a.requested_by} · {new Date(a.requested_at).toLocaleString()}{a.expires_at ? ` · approval ends ${new Date(a.expires_at).toLocaleTimeString()}` : ''} · hash {a.payload_sha256.slice(0, 12)}</p>
                {a.reason && <p className="text-xs text-fg-muted">{a.reason}</p>}
                <pre className="overflow-x-auto rounded-sm bg-surface-raised p-2 font-mono text-2xs text-fg-secondary">{JSON.stringify(a.payload, null, 2)}</pre>
                {a.error && <p className="text-xs text-danger">{a.error}</p>}
              </li>
            )
          })}
        </ul>
      )}
      {actable.length > 0 && (
        <DisclosurePanel title="Ask for an action">
          <div className="flex flex-col gap-2 p-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <SelectField label="Connector" value={connectorId} onChange={(e) => { setConnectorId(e.target.value); setAction('') }}>
                <option value="">Choose…</option>
                {actable.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </SelectField>
              <SelectField label="Action" value={action} onChange={(e) => setAction(e.target.value)} disabled={!chosen}>
                <option value="">Choose…</option>
                {(chosen?.actions ?? []).map((x) => <option key={x} value={x}>{x}</option>)}
              </SelectField>
            </div>
            <Textarea label="Payload (JSON)" value={payload} onChange={(e) => setPayload(e.target.value)} rows={6} spellCheck={false} />
            <div><Btn size="sm" onClick={ask} disabled={busy || !connectorId || !action}>Ask</Btn></div>
          </div>
        </DisclosurePanel>
      )}
      {confirm && (
        <ConfirmDialog
          title={confirm.kind === 'execute' ? `Run "${confirm.row.action}" now?` : `Reject "${confirm.row.action}"?`}
          body={
            confirm.kind === 'execute'
              ? 'This sends the approved payload to the store once. It changes the live listing or rollout and cannot be undone from Mushi.'
              : 'The request closes and cannot be approved later. Ask again if you change your mind.'
          }
          confirmLabel={confirm.kind === 'execute' ? 'Run now' : 'Reject'}
          tone="danger"
          loading={busy}
          onCancel={() => setConfirm(null)}
          onConfirm={async () => {
            const { row, kind } = confirm
            if (kind === 'execute') await run(`${path}/${row.id}/execute`, {}, 'Ran once.')
            else await run(`${path}/${row.id}/reject`, {}, 'Rejected.')
            setConfirm(null)
          }}
        />
      )}
    </Section>
  )
}
