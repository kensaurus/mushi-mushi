/**
 * FunnelCard — one funnel across every app (Plan 020 §8): the same event
 * names in the same order, side by side, so apps compare like with like.
 * An app with product events off says so; an app where nobody entered the
 * first step says so. Neither is shown as 0%.
 *
 * Data: GET /v1/admin/orgs/:orgId/funnel
 *       PUT /v1/admin/orgs/:orgId/funnel   (owners and admins)
 */

import { useState } from 'react'
import { Badge, Btn, Callout, Input, Loading, Section, SelectField, type BadgeTone } from '../ui'
import { usePageData } from '../../lib/usePageData'
import { apiFetchMutate } from '../../lib/supabase'
import { actionErrorText } from '../../lib/actionErrorText'
import { ORG_ADMIN_ONLY_HINT, useOrgCanManage } from '../../lib/useOrgCanManage'
import { PageLoadError } from '../PageLoadError'

interface FunnelResponse {
  state: 'ok' | 'not_set_up'
  definition: { steps: string[]; window: '1d' | '7d' | '30d'; lookbackDays: number } | null
  rows: Array<{
    projectId: string
    name: string
    state: 'ok' | 'off' | 'no_events' | 'error'
    steps: Array<{ name: string; converted: number; pct: number }>
    overallPct: number | null
  }>
}

const ROW_STATE: Record<string, { label: string; tone: BadgeTone }> = {
  off: { label: 'Events off', tone: 'neutral' },
  no_events: { label: 'No events yet', tone: 'neutral' },
  error: { label: 'Could not read', tone: 'warnSubtle' },
}

export function FunnelCard({ orgId }: { orgId: string }) {
  const path = `/v1/admin/orgs/${orgId}/funnel`
  const { data, loading, error, reload } = usePageData<FunnelResponse>(path)
  const [editing, setEditing] = useState(false)
  const [steps, setSteps] = useState('')
  const [convWindow, setConvWindow] = useState<'1d' | '7d' | '30d'>('7d')
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  // Setting the shared funnel is for owners and admins (QA 177).
  const { canManage } = useOrgCanManage(orgId)

  const startEdit = () => {
    setSteps((data?.definition?.steps ?? []).join(', '))
    setConvWindow(data?.definition?.window ?? '7d')
    setNotice(null)
    setEditing(true)
  }

  const save = async () => {
    setSaving(true)
    setNotice(null)
    try {
      const list = steps.split(',').map((s) => s.trim()).filter(Boolean)
      const res = await apiFetchMutate(path, { method: 'PUT', body: JSON.stringify({ steps: list, window: convWindow }) })
      if (res.ok) {
        setEditing(false)
        reload()
      } else {
        setNotice(actionErrorText(res.error, 'The funnel could not be saved.'))
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <Section title="Funnel across apps" action={data && !editing && canManage === true ? <Btn size="sm" variant="ghost" onClick={startEdit}>{data.definition ? 'Change steps' : 'Set up'}</Btn> : undefined}>
      {error && <PageLoadError error={error} resource="the funnel across apps" endpoint={path} onRetry={reload} />}
      {loading && !data && <Loading text="Reading the funnel…" />}
      {editing && (
        <div className="mb-3 flex flex-col gap-2">
          <Input label="Steps, in order (event names, comma separated)" value={steps} onChange={(e) => setSteps(e.target.value)} placeholder="signup_completed, first_lesson, day7_return" />
          <SelectField label="Counted if done within" value={convWindow} onChange={(e) => setConvWindow(e.target.value as '1d' | '7d' | '30d')}>
            <option value="1d">1 day</option>
            <option value="7d">7 days</option>
            <option value="30d">30 days</option>
          </SelectField>
          {notice && (
            <Callout tone="danger">
              <span role="status">{notice}</span>
            </Callout>
          )}
          <div className="flex gap-2">
            <Btn size="sm" onClick={save} loading={saving} disabled={saving}>Save</Btn>
            <Btn size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={saving}>Cancel</Btn>
          </div>
        </div>
      )}
      {data && data.state === 'not_set_up' && !editing && (
        <p className="text-sm text-fg-muted">
          Not set up. Pick the event names every app sends, in order, to compare sign-up to first use to coming back across apps.
          {canManage === false ? ` Setting it up: ${ORG_ADMIN_ONLY_HINT}` : ''}
        </p>
      )}
      {data && data.definition && (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-fg-muted">{data.definition.steps.join(' → ')} · within {data.definition.window} · last {data.definition.lookbackDays} days</p>
          <ul className="flex flex-col divide-y divide-edge-subtle">
            {data.rows.map((r) => (
              <li key={r.projectId} className="flex flex-col gap-1 py-2 sm:flex-row sm:items-center sm:justify-between">
                <span className="text-sm font-medium text-fg">{r.name}</span>
                {r.state === 'ok' ? (
                  <span className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
                    {r.steps.map((s) => <span key={s.name}>{s.name}: {s.converted}</span>)}
                    <Badge tone="infoSubtle">{r.overallPct}% end to end</Badge>
                  </span>
                ) : (
                  <Badge tone={(ROW_STATE[r.state] ?? ROW_STATE.error).tone}>{(ROW_STATE[r.state] ?? ROW_STATE.error).label}</Badge>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Section>
  )
}
