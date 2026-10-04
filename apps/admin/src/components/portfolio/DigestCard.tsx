/**
 * DigestCard — the daily digest across a team's apps (Plan 020 §9). Off by
 * default. Shows today's preview; owners and admins pick where it goes
 * (a project's Slack channel, Discord or Teams webhook, or Telegram chats;
 * email; push), the hour it is sent, and the weekday of the weekly
 * signups and activations line.
 *
 * Data: GET /v1/admin/orgs/:orgId/digest → DigestPreviewResponse
 *       PUT /v1/admin/orgs/:orgId/digest/settings
 *       POST /v1/admin/orgs/:orgId/digest/send
 */

import { useState } from 'react'
import { Btn, Callout, Card, Loading, Section } from '../ui'
import { usePageData } from '../../lib/usePageData'
import { apiFetchMutate } from '../../lib/supabase'
import { actionErrorText } from '../../lib/actionErrorText'
import { ORG_ADMIN_ONLY_HINT, useOrgCanManage } from '../../lib/useOrgCanManage'
import { PageLoadError } from '../PageLoadError'
import type { DigestPreviewResponse, DigestSettingsView } from '../../lib/radarTypes'

interface ProjectOption {
  projectId: string
  name: string
}

const SELECT = 'rounded-sm border border-edge bg-surface-root px-2 py-1 text-xs'
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** One "send through this project's <channel>" picker; the project's existing connection is reused. */
function ProjectChannel({ label, none, value, projects, onChange }: { label: string; none: string; value: string | null; projects: ProjectOption[]; onChange: (projectId: string | null) => void }) {
  return (
    <label className="flex flex-wrap items-center gap-2">
      <span className="text-fg-muted">{label}</span>
      <select className={SELECT} value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">{none}</option>
        {projects.map((p) => <option key={p.projectId} value={p.projectId}>{p.name}</option>)}
      </select>
    </label>
  )
}

export function DigestCard({ orgId, projects }: { orgId: string; projects: ProjectOption[] }) {
  const path = `/v1/admin/orgs/${orgId}/digest`
  const { data, loading, error, reload } = usePageData<DigestPreviewResponse>(path)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ tone: 'info' | 'danger'; text: string } | null>(null)
  // Changing or sending the digest is for owners and admins (QA 177): others
  // see the settings read-only instead of a form that always answers 403.
  const { canManage } = useOrgCanManage(orgId)

  const save = async (patch: Partial<DigestSettingsView>) => {
    if (!data) return
    const next = { ...data.settings, ...patch }
    setBusy(true)
    setNotice(null)
    try {
      const res = await apiFetchMutate<DigestSettingsView>(`${path}/settings`, {
        method: 'PUT',
        body: JSON.stringify({
          enabled: next.enabled,
          slackProjectId: next.slackProjectId,
          discordProjectId: next.discordProjectId,
          teamsProjectId: next.teamsProjectId,
          telegramProjectId: next.telegramProjectId,
          email: next.email,
          webPush: next.webPush,
          sendHourUtc: next.sendHourUtc,
          gtmWeekday: next.gtmWeekday,
        }),
      })
      if (!res.ok) setNotice({ tone: 'danger', text: actionErrorText(res.error, 'The digest settings could not be saved.') })
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
      if (!res.ok || !res.data) setNotice({ tone: 'danger', text: actionErrorText(res.error, 'The digest could not be sent.') })
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
      <p className="mb-3 text-xs text-fg-muted">One message a day across all your apps: new reports, holes found, releases and a jump in AI spend, plus once a week each app's signups and activations from the team funnel. Off until you pick where it goes.</p>
      {error && <PageLoadError error={error} resource="the daily digest" endpoint={path} onRetry={reload} />}
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
          {canManage === false && <p className="text-xs text-fg-muted">Digest settings: {ORG_ADMIN_ONLY_HINT}</p>}
          <fieldset className="flex flex-col gap-2 text-sm" disabled={busy || canManage === false}>
            <legend className="sr-only">Where to send the digest</legend>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={s.enabled} onChange={(e) => save({ enabled: e.target.checked })} />
              <span>Send the digest every day</span>
            </label>
            <ProjectChannel label="Slack channel of" none="No Slack" value={s.slackProjectId} projects={projects} onChange={(id) => save({ slackProjectId: id })} />
            <ProjectChannel label="Discord webhook of" none="No Discord" value={s.discordProjectId} projects={projects} onChange={(id) => save({ discordProjectId: id })} />
            <ProjectChannel label="Teams webhook of" none="No Teams" value={s.teamsProjectId} projects={projects} onChange={(id) => save({ teamsProjectId: id })} />
            <ProjectChannel label="Telegram chats of" none="No Telegram" value={s.telegramProjectId} projects={projects} onChange={(id) => save({ telegramProjectId: id })} />
            <p className="text-2xs text-fg-faint">Each uses that app's own connection from Integrations; nothing new to set up.</p>
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
            <label className="flex flex-wrap items-center gap-2">
              <span className="text-fg-muted">Weekly signups and activations on</span>
              <select
                className={SELECT}
                value={s.gtmWeekday === null ? '' : String(s.gtmWeekday)}
                onChange={(e) => save({ gtmWeekday: e.target.value === '' ? null : Number(e.target.value) })}
              >
                <option value="">Never</option>
                {WEEKDAYS.map((d, i) => <option key={d} value={i}>{`${d} (UTC)`}</option>)}
              </select>
            </label>
          </fieldset>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-fg-muted">
            <span>
              {s.lastSentAt ? `Last sent ${new Date(s.lastSentAt).toLocaleString()} (${s.lastStatus ?? 'unknown'})` : 'Never sent yet.'}
              {s.lastError ? ` ${s.lastError}` : ''}
            </span>
            {canManage !== false && (
              <Btn size="sm" variant="ghost" onClick={sendNow} loading={busy} disabled={busy || !s.enabled}>
                Send now
              </Btn>
            )}
          </div>
        </div>
      )}
    </Section>
  )
}
