/**
 * DigestCard — the daily digest across a team's apps (Plan 020 §9). Off by
 * default. Shows today's preview; owners and admins pick where it goes
 * (a project's Slack channel, email, push) and the hour it is sent.
 *
 * Data: GET /v1/admin/orgs/:orgId/digest → DigestPreviewResponse
 *       PUT /v1/admin/orgs/:orgId/digest/settings
 *       POST /v1/admin/orgs/:orgId/digest/send
 */

import { useState } from 'react'
import { Btn, Callout, Card, ErrorAlert, Loading, Section } from '../ui'
import { usePageData } from '../../lib/usePageData'
import { apiFetchMutate } from '../../lib/supabase'
import type { DigestPreviewResponse, DigestSettingsView } from '../../lib/radarTypes'

interface ProjectOption {
  projectId: string
  name: string
}

export function DigestCard({ orgId, projects }: { orgId: string; projects: ProjectOption[] }) {
  const path = `/v1/admin/orgs/${orgId}/digest`
  const { data, loading, error, reload } = usePageData<DigestPreviewResponse>(path)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ tone: 'info' | 'danger'; text: string } | null>(null)

  const save = async (patch: Partial<DigestSettingsView>) => {
    if (!data) return
    const next = { ...data.settings, ...patch }
    setBusy(true)
    setNotice(null)
    try {
      const res = await apiFetchMutate<DigestSettingsView>(`${path}/settings`, {
        method: 'PUT',
        body: JSON.stringify({ enabled: next.enabled, slackProjectId: next.slackProjectId, email: next.email, webPush: next.webPush, sendHourUtc: next.sendHourUtc }),
      })
      if (!res.ok) setNotice({ tone: 'danger', text: res.error?.message ?? 'The digest settings could not be saved.' })
    } finally {
      setBusy(false)
      reload()
    }
  }

  const sendNow = async () => {
    setBusy(true)
    setNotice(null)
    try {
      const res = await apiFetchMutate<{ status: string; channels: Array<{ channel: string; ok: boolean; detail: string }> }>(`${path}/send`, { method: 'POST', body: '{}' })
      if (!res.ok || !res.data) setNotice({ tone: 'danger', text: res.error?.message ?? 'The digest could not be sent.' })
      else if (res.data.status === 'nothing_to_send') setNotice({ tone: 'info', text: 'Nothing new today, so nothing was sent.' })
      else setNotice({ tone: res.data.status === 'sent' ? 'info' : 'danger', text: res.data.channels.map((c) => `${c.channel}: ${c.detail}`).join(' · ') })
    } finally {
      setBusy(false)
      reload()
    }
  }

  const s = data?.settings
  return (
    <Section title="Daily digest">
      <p className="mb-3 text-xs text-fg-muted">One message a day across all your apps: new reports, holes found, releases and a jump in AI spend. Off until you pick where it goes.</p>
      {error && <ErrorAlert message={error} endpoint={path} onRetry={reload} />}
      {loading && !data && <Loading text="Building today's digest…" />}
      {notice && (
        <Callout tone={notice.tone}>
          <span role="status">{notice.text}</span>
        </Callout>
      )}
      {data && s && (
        <div className="flex flex-col gap-3">
          <Card className="p-3">
            <p className="text-xs font-medium text-fg">{data.preview.title}</p>
            {data.preview.lines.length === 0 ? (
              <p className="mt-1 text-xs text-fg-muted">Nothing new across your apps today.</p>
            ) : (
              <ul className="mt-1 list-disc pl-4 text-xs text-fg-secondary">
                {data.preview.lines.map((l) => <li key={l}>{l}</li>)}
              </ul>
            )}
          </Card>
          <fieldset className="flex flex-col gap-2 text-sm" disabled={busy}>
            <legend className="sr-only">Where to send the digest</legend>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={s.enabled} onChange={(e) => save({ enabled: e.target.checked })} />
              <span>Send the digest every day</span>
            </label>
            <label className="flex flex-wrap items-center gap-2">
              <span className="text-fg-muted">Slack channel of</span>
              <select
                className="rounded-sm border border-edge bg-surface-root px-2 py-1 text-xs"
                value={s.slackProjectId ?? ''}
                onChange={(e) => save({ slackProjectId: e.target.value || null })}
              >
                <option value="">No Slack</option>
                {projects.map((p) => <option key={p.projectId} value={p.projectId}>{p.name}</option>)}
              </select>
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={s.email} onChange={(e) => save({ email: e.target.checked })} />
              <span>Email the team's owners and admins</span>
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={s.webPush} onChange={(e) => save({ webPush: e.target.checked })} />
              <span>Push to their devices</span>
            </label>
            <label className="flex flex-wrap items-center gap-2">
              <span className="text-fg-muted">Send at</span>
              <select
                className="rounded-sm border border-edge bg-surface-root px-2 py-1 text-xs"
                value={s.sendHourUtc}
                onChange={(e) => save({ sendHourUtc: Number(e.target.value) })}
              >
                {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{`${String(h).padStart(2, '0')}:00 UTC`}</option>)}
              </select>
            </label>
          </fieldset>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-fg-muted">
            <span>
              {s.lastSentAt ? `Last sent ${new Date(s.lastSentAt).toLocaleString()} (${s.lastStatus ?? 'unknown'})` : 'Never sent yet.'}
              {s.lastError ? ` ${s.lastError}` : ''}
            </span>
            <Btn size="sm" variant="ghost" onClick={sendNow} loading={busy} disabled={busy || !s.enabled}>
              Send now
            </Btn>
          </div>
        </div>
      )}
    </Section>
  )
}
