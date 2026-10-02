/**
 * FILE: apps/admin/src/components/report-detail/ReporterViewPanel.tsx
 * PURPOSE: "Reporter view" for one report (Plan 018 §5): the exact status pill
 *          and thread the end user sees in the widget, messages still held in
 *          the Outbox, and "Ask for more info".
 *
 * The pill comes from `@mushi-mushi/core/reporter-ui` — the same table the
 * SDK widgets use — fed by GET /v1/admin/reports/:id/reporter-view, so the
 * console can never preview a label the reporter would not see.
 *
 * Mount: <ReporterViewPanel reportId={report.id} /> anywhere in report detail.
 */

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { reporterStatus, type ReporterTimelineKind } from '@mushi-mushi/core/reporter-ui'
import { usePageData } from '../../lib/usePageData'
import { apiFetch } from '../../lib/supabase'
import { useToast } from '../../lib/toast'
import { Badge, Btn, Card, ErrorAlert, RelativeTime } from '../ui'

interface ReporterViewTimelineItem {
  kind: ReporterTimelineKind
  at: string
  text: string
}

interface ReporterView {
  has_reporter: boolean
  status_input: {
    status: string
    awaiting_reporter: boolean
    fixed_in_version: string | null
    closed_reason: string | null
    group_bucket: 'none' | 'few' | 'many'
    user_category: string | null
  }
  title: string
  timeline: ReporterViewTimelineItem[]
  pending: Array<{ id: string; notification_type: string; text: string; created_at: string }>
  unread_by_reporter: number
  followers: number
  reporter_replied_unseen: boolean
}

const KIND_LABEL: Partial<Record<ReporterTimelineKind, string>> = {
  received: 'Reported',
  comment: 'You replied',
  reporter_comment: 'Reporter',
  info_requested: 'You asked',
}

const QUESTION_MAX = 2000

export function ReporterViewPanel({ reportId }: { reportId: string }) {
  const toast = useToast()
  const { data, loading, error, reload } = usePageData<ReporterView>(
    `/v1/admin/reports/${reportId}/reporter-view`,
    { deps: [reportId] },
  )
  const [question, setQuestion] = useState('')
  const [asking, setAsking] = useState(false)

  const ask = async () => {
    const text = question.trim()
    if (!text) return
    setAsking(true)
    try {
      const res = await apiFetch(`/v1/admin/reports/${reportId}/request-info`, {
        method: 'POST',
        body: JSON.stringify({ question: text }),
      })
      if (!res.ok) throw new Error(res.error?.message ?? 'Could not send the question')
      setQuestion('')
      toast.success('Question sent — the report now shows “Waiting on you” to the reporter.')
      reload()
    } catch (err) {
      toast.error('Could not ask the reporter', err instanceof Error ? err.message : String(err))
    } finally {
      setAsking(false)
    }
  }

  if (loading && !data) {
    return (
      <Card className="p-4">
        <div className="space-y-2" aria-busy="true" aria-label="Loading reporter view">
          <div className="h-4 w-32 rounded bg-surface-raised" />
          <div className="h-3 w-48 rounded bg-surface-raised" />
        </div>
      </Card>
    )
  }
  if (error) {
    return <ErrorAlert title="Reporter view unavailable" message={error} onRetry={reload} />
  }
  if (!data) return null

  if (!data.has_reporter) {
    return (
      <Card className="p-4 space-y-1">
        <h3 className="text-sm font-semibold text-fg">Reporter view</h3>
        <p className="text-xs text-fg-muted">
          This report came from an integration, not the in-app widget, so there is no reporter to update.
        </p>
      </Card>
    )
  }

  const view = reporterStatus(data.status_input)

  return (
    <Card className="p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-fg">Reporter view</h3>
        <div className="flex flex-wrap items-center gap-1.5">
          {data.reporter_replied_unseen && <Badge tone="warn">Reporter replied</Badge>}
          {data.unread_by_reporter > 0 && (
            <Badge tone="infoSubtle">
              {data.unread_by_reporter} unread by reporter
            </Badge>
          )}
          {data.followers > 0 && (
            <Badge tone="infoSubtle">
              {data.followers} follower{data.followers === 1 ? '' : 's'}
            </Badge>
          )}
        </div>
      </div>

      <div className="space-y-1">
        <Badge tone={view.tone === 'attention' ? 'warn' : view.tone === 'success' ? 'ok' : 'infoSubtle'}>{view.label}</Badge>
        <p className="text-xs text-fg-muted">{view.detail}</p>
        {view.othersNote && <p className="text-xs text-fg-muted">{view.othersNote}</p>}
        {view.hidden && <p className="text-xs text-fg-muted">Closed as spam — hidden from the reporter.</p>}
      </div>

      {data.pending.length > 0 && (
        <div className="rounded-md border border-edge-subtle p-2 space-y-1">
          <p className="text-xs font-medium text-fg">
            {data.pending.length} update{data.pending.length === 1 ? '' : 's'} waiting for review
          </p>
          {data.pending.map((p) => (
            <p key={p.id} className="text-xs text-fg-muted">
              {p.text}
            </p>
          ))}
          <Link
            to="/notifications?tab=outbox"
            className="text-xs text-accent-foreground hover:text-accent underline underline-offset-2"
          >
            Review in Outbox
          </Link>
        </div>
      )}

      <ol className="space-y-1.5" aria-label="What the reporter sees">
        {data.timeline.map((item, i) => (
          <li key={`${item.kind}-${item.at}-${i}`} className="flex items-start gap-2 text-xs">
            <span className="w-20 shrink-0 text-fg-muted">
              <RelativeTime value={item.at} />
            </span>
            <span className="text-fg">
              {KIND_LABEL[item.kind] ? <span className="font-medium">{KIND_LABEL[item.kind]}: </span> : null}
              {item.text}
            </span>
          </li>
        ))}
      </ol>

      <div className="space-y-1.5">
        <label htmlFor={`ask-${reportId}`} className="text-xs font-medium text-fg">
          Ask for more info
        </label>
        <textarea
          id={`ask-${reportId}`}
          value={question}
          onChange={(e) => setQuestion(e.target.value.slice(0, QUESTION_MAX))}
          rows={2}
          placeholder="Which page were you on? What device?"
          className="w-full rounded-md border border-edge-subtle bg-surface px-2 py-1.5 text-xs text-fg"
        />
        <div className="flex items-center justify-between gap-2">
          <span className="text-2xs text-fg-muted">
            Shown to the reporter verbatim; their report reads “Waiting on you” until they answer.
          </span>
          <Btn size="sm" onClick={() => void ask()} loading={asking} disabled={!question.trim()}>
            Ask reporter
          </Btn>
        </div>
      </div>
    </Card>
  )
}
