/**
 * FILE: apps/admin/src/components/reports/ReportsFileIssue.tsx
 * PURPOSE: "Report an issue" on Bugs: the app's owner writes up something
 *          they noticed in their own app (a bug, something slow, something
 *          that looks wrong or confuses, an idea) the way a user would in the
 *          widget, without opening the app. POST /v1/admin/projects/:id/reports
 *          files it, triage classifies it like any report, and "Fix it on"
 *          puts it first in one of the app's local worker lanes (ADR 0048), so
 *          a report can go from the console to a fix PR without a terminal.
 */
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { apiFetch } from '../../lib/supabase'
import { usePageData } from '../../lib/usePageData'
import { LANES_PATH, type WorkLanesData } from '../../lib/workers'
import { Btn, Card, Input, SelectField, Textarea } from '../ui'

export const ISSUE_KINDS = [
  { id: 'bug', label: 'Something is broken' },
  { id: 'slow', label: 'Something is slow' },
  { id: 'visual', label: 'Something looks wrong' },
  { id: 'confusing', label: 'Something is confusing' },
  { id: 'other', label: 'An idea or improvement' },
] as const
type IssueKind = (typeof ISSUE_KINDS)[number]['id']

const SEVERITIES = [
  { id: '', label: 'Let Mushi decide' },
  { id: 'critical', label: 'Critical: people cannot use the app' },
  { id: 'high', label: 'High: a main task is blocked or wrong' },
  { id: 'medium', label: 'Medium: annoying, there is a way around it' },
  { id: 'low', label: 'Low: small polish' },
] as const

interface Props {
  projectId: string
  projectName: string | null
  onClose: () => void
  onFiled: () => void
}

interface Filed {
  reportId: string
}

export function ReportsFileIssue({ projectId, projectName, onClose, onFiled }: Props) {
  const [kind, setKind] = useState<IssueKind>('bug')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [component, setComponent] = useState('')
  const [severity, setSeverity] = useState('')
  const [laneId, setLaneId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filed, setFiled] = useState<Filed[]>([])
  const lanes = usePageData<WorkLanesData>(LANES_PATH)
  // Fix lanes for this app on the caller's own machines: the server queues only
  // onto a machine you own (a lane runs code there), and follow-up, conflict
  // and audit lanes take no filed report.
  const myHosts = new Set((lanes.data?.hosts ?? []).filter((h) => h.mine).map((h) => h.id))
  const fixLanes = (lanes.data?.lanes ?? []).filter((l) => l.projectId === projectId && myHosts.has(l.hostId) && (l.config?.mode ?? 'fix') === 'fix')

  const canSend = title.trim().length >= 3 && description.trim().length > 0 && !busy

  async function send() {
    setBusy(true)
    setError(null)
    const res = await apiFetch<Filed>(`/v1/admin/projects/${encodeURIComponent(projectId)}/reports`, {
      method: 'POST',
      body: JSON.stringify({
        title: title.trim(),
        description: description.trim(),
        category: kind,
        ...(component.trim() ? { component: component.trim() } : {}),
        ...(severity ? { severity } : {}),
        ...(laneId ? { queue: { laneId } } : {}),
      }),
    })
    setBusy(false)
    if (!res.ok || !res.data) {
      setError(res.error?.message ?? 'The report was not filed. Try again in a moment.')
      return
    }
    setFiled((f) => [res.data!, ...f])
    setTitle('')
    setDescription('')
    setComponent('')
    setSeverity('')
    onFiled()
  }

  return (
    <Card className="p-4 flex flex-col gap-3" data-testid="mushi-reports-file-issue">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-fg">Report an issue in {projectName ?? 'this app'}</h2>
          <p className="text-xs text-fg-muted">
            Write it the way a user would. Mushi explains it and, with a worker lane chosen, opens a fix PR.
          </p>
        </div>
        <Btn type="button" variant="ghost" size="sm" onClick={onClose} aria-label="Close report form">
          Close
        </Btn>
      </div>

      <SelectField label="What kind of issue" value={kind} onChange={(e) => setKind(e.target.value as IssueKind)}>
        {ISSUE_KINDS.map((k) => (
          <option key={k.id} value={k.id}>
            {k.label}
          </option>
        ))}
      </SelectField>
      <Input
        label="In one line"
        placeholder="e.g. The Account page takes 5 seconds to open"
        value={title}
        maxLength={200}
        onChange={(e) => setTitle(e.target.value)}
      />
      <Textarea
        label="What happened, and what you expected"
        placeholder={'Steps: 1. Open … 2. Tap …\nWhat I saw: …\nWhat I expected: …'}
        value={description}
        maxLength={10_000}
        rows={6}
        onChange={(e) => setDescription(e.target.value)}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <Input
          label="Where (screen or page, optional)"
          placeholder="e.g. Account, Transfer, Search"
          value={component}
          maxLength={200}
          onChange={(e) => setComponent(e.target.value)}
        />
        <SelectField label="How bad" value={severity} onChange={(e) => setSeverity(e.target.value)}>
          {SEVERITIES.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </SelectField>
      </div>
      {fixLanes.length > 0 && (
        <SelectField label="Fix it on (optional)" value={laneId} onChange={(e) => setLaneId(e.target.value)}>
          <option value="">Let Mushi pick (cloud or any lane)</option>
          {fixLanes.map((l) => (
            <option key={l.id} value={l.id}>
              Local worker lane {l.name}
            </option>
          ))}
        </SelectField>
      )}

      {error && (
        <p className="text-xs text-danger" role="alert">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Btn type="button" size="sm" onClick={() => void send()} disabled={!canSend} data-testid="mushi-reports-file-issue-send">
          {busy ? 'Filing…' : 'File report'}
        </Btn>
        <span className="text-2xs text-fg-faint">Counts toward the app's diagnoses, like a report from the widget.</span>
      </div>

      {filed.length > 0 && (
        <ul className="flex flex-col gap-1 text-xs" aria-label="Filed reports">
          {filed.map((f) => (
            <li key={f.reportId}>
              Filed. <Link to={`/reports/${f.reportId}`} className="underline">Open the report</Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
