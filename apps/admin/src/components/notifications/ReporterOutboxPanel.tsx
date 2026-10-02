/**
 * FILE: apps/admin/src/components/notifications/ReporterOutboxPanel.tsx
 * PURPOSE: The reporter-update Outbox (Plan 018 decision 7) — the Outbox tab
 *          on /notifications.
 *
 * - "Send automatically" (default) vs "Review first": in review mode the
 *   pipeline's reporter messages (fix in progress, fixed, shipped in vX,
 *   closed) wait here. Direct replies are never held.
 * - Each held message can be released as-is, edited then released, or
 *   discarded. The text shown is exactly what the reporter will read.
 * - "What the reporter sees" opens the ReporterViewPanel for that report, so
 *   the reviewer checks the update against the thread it lands in.
 */

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { usePageData } from '../../lib/usePageData'
import { apiFetch } from '../../lib/supabase'
import { useToast } from '../../lib/toast'
import { Badge, Btn, Card, EmptyState, ErrorAlert, RelativeTime, SegmentedControl } from '../ui'
import { TableSkeleton } from '../skeletons/TableSkeleton'
import { ReporterViewPanel } from '../report-detail/ReporterViewPanel'

interface OutboxMessage {
  id: string
  report_id: string | null
  report_title: string | null
  notification_type: string
  text: string
  body_override: string | null
  created_at: string
}

type Mode = 'auto' | 'review'

const TYPE_LABEL: Record<string, string> = {
  confirmed: 'Fix in progress',
  fix_started: 'Fix in progress',
  fixed: 'Fixed',
  released: 'Shipped',
  dismissed: 'Closed',
  closed: 'Closed',
}

const OVERRIDE_MAX = 1000

export function ReporterOutboxPanel({ projectId }: { projectId: string }) {
  const toast = useToast()
  const modePath = `/v1/admin/reporter-updates-mode?project_id=${encodeURIComponent(projectId)}`
  const listPath = `/v1/admin/reporter-outbox?project_id=${encodeURIComponent(projectId)}`
  const { data: modeData, reload: reloadMode } = usePageData<{ mode: Mode }>(modePath, { deps: [projectId] })
  const { data, loading, error, reload } = usePageData<{ messages: OutboxMessage[] }>(listPath, { deps: [projectId] })
  const [busy, setBusy] = useState<string | null>(null)
  const [editing, setEditing] = useState<Record<string, string>>({})
  const [savingMode, setSavingMode] = useState(false)
  const [previewing, setPreviewing] = useState<string | null>(null)

  const mode: Mode = modeData?.mode ?? 'auto'
  const messages = data?.messages ?? []

  const setMode = async (next: Mode) => {
    if (next === mode) return
    setSavingMode(true)
    try {
      const res = await apiFetch('/v1/admin/reporter-updates-mode', {
        method: 'PUT',
        body: JSON.stringify({ project_id: projectId, mode: next }),
      })
      if (!res.ok) throw new Error(res.error?.message ?? 'Could not save')
      toast.success(next === 'review' ? 'Pipeline updates now wait for your review.' : 'Pipeline updates now go out automatically.')
      reloadMode()
    } catch (err) {
      toast.error('Could not change the update mode', err instanceof Error ? err.message : String(err))
    } finally {
      setSavingMode(false)
    }
  }

  const act = async (msg: OutboxMessage, action: 'release' | 'discard') => {
    setBusy(msg.id)
    try {
      const override = editing[msg.id]?.trim()
      const res = await apiFetch(`/v1/admin/reporter-outbox/${msg.id}/${action}`, {
        method: 'POST',
        body: JSON.stringify(action === 'release' && override ? { body_override: override } : {}),
      })
      if (!res.ok) throw new Error(res.error?.message ?? `Could not ${action}`)
      const failed = (res.data as { failed?: string[] } | undefined)?.failed ?? []
      if (action === 'release' && failed.length > 0) {
        toast.error('Released, but a channel failed', failed.join(', '))
      } else {
        toast.success(action === 'release' ? 'Sent to the reporter.' : 'Discarded — the reporter will not see it.')
      }
      setEditing((prev) => {
        const next = { ...prev }
        delete next[msg.id]
        return next
      })
      reload()
    } catch (err) {
      toast.error(`Could not ${action} the update`, err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-3">
      <Card className="p-4 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-fg">Reporter updates</h3>
            <p className="text-xs text-fg-muted">
              “Fix in progress”, “Fixed”, “Shipped in vX” and “Closed” messages to the people who reported bugs.
              Your own replies always go out immediately.
            </p>
          </div>
          <SegmentedControl<Mode>
            ariaLabel="Reporter update mode"
            value={mode}
            onChange={(next) => void setMode(next)}
            options={[
              { id: 'auto', label: savingMode && mode !== 'auto' ? 'Saving…' : 'Send automatically' },
              { id: 'review', label: savingMode && mode !== 'review' ? 'Saving…' : 'Review first' },
            ]}
          />
        </div>
      </Card>

      {error ? (
        <ErrorAlert title="Outbox unavailable" message={error} onRetry={reload} />
      ) : loading && !data ? (
        <TableSkeleton rows={3} columns={3} showFilters={false} />
      ) : messages.length === 0 ? (
        <EmptyState
          title="Nothing waiting"
          description={
            mode === 'review'
              ? 'Pipeline updates land here before reporters see them.'
              : 'Updates go out automatically. Switch to “Review first” to check each one before it is sent.'
          }
        />
      ) : (
        <ul className="space-y-2">
          {messages.map((msg) => {
            const draft = editing[msg.id]
            return (
              <li key={msg.id}>
                <Card className="p-3 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2 min-w-0">
                      <Badge tone="infoSubtle">{TYPE_LABEL[msg.notification_type] ?? msg.notification_type}</Badge>
                      {msg.report_id ? (
                        <Link
                          to={`/reports/${msg.report_id}`}
                          className="truncate text-xs text-fg hover:text-accent underline-offset-2 hover:underline"
                        >
                          {msg.report_title || 'Untitled report'}
                        </Link>
                      ) : null}
                    </div>
                    <span className="text-2xs text-fg-muted">
                      <RelativeTime value={msg.created_at} />
                    </span>
                  </div>
                  {draft !== undefined ? (
                    <textarea
                      aria-label="Message to the reporter"
                      value={draft}
                      onChange={(e) =>
                        setEditing((prev) => ({ ...prev, [msg.id]: e.target.value.slice(0, OVERRIDE_MAX) }))
                      }
                      rows={2}
                      className="w-full rounded-md border border-edge-subtle bg-surface px-2 py-1.5 text-xs text-fg"
                    />
                  ) : (
                    <p className="text-xs text-fg">{msg.body_override || msg.text}</p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <Btn size="sm" onClick={() => void act(msg, 'release')} loading={busy === msg.id} disabled={busy !== null && busy !== msg.id}>
                      {draft !== undefined ? 'Send edited' : 'Send'}
                    </Btn>
                    {draft === undefined && (
                      <Btn
                        size="sm"
                        variant="ghost"
                        onClick={() => setEditing((prev) => ({ ...prev, [msg.id]: msg.body_override || msg.text }))}
                        disabled={busy !== null}
                      >
                        Edit
                      </Btn>
                    )}
                    <Btn size="sm" variant="ghost" onClick={() => void act(msg, 'discard')} disabled={busy !== null}>
                      Discard
                    </Btn>
                    {msg.report_id && (
                      <Btn
                        size="sm"
                        variant="ghost"
                        aria-expanded={previewing === msg.id}
                        onClick={() => setPreviewing((cur) => (cur === msg.id ? null : msg.id))}
                      >
                        {previewing === msg.id ? 'Hide reporter view' : 'What the reporter sees'}
                      </Btn>
                    )}
                  </div>
                  {previewing === msg.id && msg.report_id && <ReporterViewPanel reportId={msg.report_id} />}
                </Card>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
