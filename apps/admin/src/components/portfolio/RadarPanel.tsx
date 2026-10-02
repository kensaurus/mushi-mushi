/**
 * RadarPanel — the hole checks for one project (Plan 020 Phase 1), shown on
 * the Recipe page. Every check is listed; one that never ran says "Not
 * checked yet" and is never shown as passing.
 *
 * Data: GET /v1/admin/projects/:id/radar → RadarView
 *       POST /v1/admin/projects/:id/radar/run (202; 1 per 10 min)
 */

import { useState } from 'react'
import { Badge, Btn, Callout, CopyButton, ErrorAlert, Loading, Section } from '../ui'
import { usePageData } from '../../lib/usePageData'
import { apiFetchMutate } from '../../lib/supabase'
import type { RadarView } from '../../lib/radarTypes'
import { radarStateMeta } from './portfolioView'

export function RadarPanel({ projectId }: { projectId: string }) {
  const path = `/v1/admin/projects/${projectId}/radar`
  const { data, loading, error, reload } = usePageData<RadarView>(path)
  const [running, setRunning] = useState(false)
  const [notice, setNotice] = useState<{ tone: 'info' | 'danger'; text: string } | null>(null)

  const run = async () => {
    setRunning(true)
    setNotice(null)
    try {
      const res = await apiFetchMutate<{ started: boolean }>(`${path}/run`, { method: 'POST', body: '{}' })
      setNotice(res.ok
        ? { tone: 'info', text: 'The checks are running. Refresh in a minute to see the results.' }
        : { tone: 'danger', text: res.error?.message ?? 'The checks could not start.' })
    } finally {
      setRunning(false)
    }
  }

  return (
    <Section
      title="Hole checks"
      action={
        <Btn size="sm" variant="ghost" onClick={run} loading={running} disabled={running} title="Run every hole check for this app now">
          Run checks
        </Btn>
      }
    >
      <p className="mb-3 text-xs text-fg-muted">
        Problems that never throw an error: store rules, an expiring domain, a broken privacy link, storage that keeps billing.
      </p>
      {notice && (
        <Callout tone={notice.tone}>
          <span role="status">{notice.text}</span>
        </Callout>
      )}
      {error && <ErrorAlert message={error} endpoint={path} onRetry={reload} />}
      {loading && !data && <Loading text="Reading the hole checks…" />}
      {data && (
        <ul className="flex flex-col divide-y divide-edge-subtle">
          {data.detectors.map((d) => {
            const meta = radarStateMeta(d.state)
            return (
              <li key={d.ruleId} className="flex flex-col gap-1 py-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-medium text-fg" title={d.prevents}>{d.title}</span>
                  <Badge tone={meta.tone}>{meta.label}</Badge>
                </div>
                <p className="text-xs text-fg-muted">{d.reason}</p>
                {d.findings.map((f) => (
                  <div key={f.id} className="flex flex-col gap-1 rounded-md border border-edge-subtle p-2 text-xs sm:flex-row sm:items-start sm:justify-between">
                    <span className="min-w-0 text-fg">{f.message}</span>
                    {f.fix && <CopyButton value={`${f.message}\n\nFix: ${f.fix}`} label="Copy fix prompt" />}
                  </div>
                ))}
              </li>
            )
          })}
        </ul>
      )}
    </Section>
  )
}
