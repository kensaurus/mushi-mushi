/**
 * RadarPanel — the risk checks ("radar") for one project (Plan 020 Phase 1), shown on
 * the Recipe page. Every check is listed; one that never ran says "Not
 * checked yet" and is never shown as passing.
 *
 * Problems lead (Found, then Check failed); checks that never ran and passing
 * checks sit in two closed disclosures. A failed check reads as a sentence
 * with its last-run time; the raw server error stays behind "Show the error".
 * Mushi's own setup checks (gate `radar`) are listed on the Full-stack audit
 * page, which this panel links to instead of repeating them.
 *
 * Data: GET /v1/admin/projects/:id/radar → RadarView
 *       POST /v1/admin/projects/:id/radar/run (202; 1 per 10 min)
 */

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge, Btn, Callout, CopyButton, Loading, Section, formatRelative } from '../ui'
import { PageLoadError } from '../PageLoadError'
import { usePageData } from '../../lib/usePageData'
import { apiFetchMutate } from '../../lib/supabase'
import { LINK_ACCENT } from '../../lib/chipTone'
import type { RadarView } from '../../lib/radarTypes'
import { groupRadarDetectors, radarErrorSentence, radarStateMeta } from './portfolioView'

type Detector = RadarView['detectors'][number]

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

  const groups = data ? groupRadarDetectors(data.detectors) : null

  return (
    <Section
      title="Risk checks"
      action={
        <Btn size="sm" variant="ghost" onClick={run} loading={running} disabled={running} title="Run every risk check for this app now">
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
      {error && <PageLoadError error={error} resource="the radar checks" endpoint={path} onRetry={reload} />}
      {loading && !data && <Loading text="Reading the risk checks…" />}
      {groups && (
        <div className="flex flex-col gap-2">
          {groups.problems.length > 0 ? (
            <DetectorList detectors={groups.problems} />
          ) : (
            <p className="text-xs text-fg-muted">
              {groups.passing.length > 0 ? 'No check found a problem.' : 'No check has a result yet.'}
            </p>
          )}
          {groups.notChecked.length > 0 && (
            <details className="rounded-md border border-edge-subtle px-3 py-2">
              <summary className="cursor-pointer text-xs text-fg-muted hover:text-fg">
                {groups.notChecked.length} not checked yet (not a pass)
              </summary>
              <DetectorList detectors={groups.notChecked} />
            </details>
          )}
          {groups.passing.length > 0 && (
            <details className="rounded-md border border-edge-subtle px-3 py-2">
              <summary className="cursor-pointer text-xs text-fg-muted hover:text-fg">
                {groups.passing.length} passing
              </summary>
              <DetectorList detectors={groups.passing} />
            </details>
          )}
        </div>
      )}
      <p className="mt-3 border-t border-edge-subtle pt-3 text-xs text-fg-muted">
        Mushi's own setup checks (provider keys, spend caps and the AI budget, webhooks, index freshness) are on the{' '}
        <Link to="/fullstack-audit" className={LINK_ACCENT}>Full-stack audit</Link> page.
      </p>
    </Section>
  )
}

function DetectorList({ detectors }: { detectors: Detector[] }) {
  return (
    <ul className="flex flex-col divide-y divide-edge-subtle">
      {detectors.map((d) => {
        const meta = radarStateMeta(d.state)
        return (
          <li key={d.ruleId} className="flex flex-col gap-1 py-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-medium text-fg" title={d.prevents}>{d.title}</span>
              <Badge tone={meta.tone}>{meta.label}</Badge>
            </div>
            {d.state === 'error' ? (
              <>
                <p className="text-xs text-fg-muted">{radarErrorSentence(d.checkedAt, formatRelative)}</p>
                <details className="text-2xs text-fg-faint">
                  <summary className="cursor-pointer hover:text-fg-secondary">Show the error</summary>
                  <p className="mt-1 font-mono wrap-break-word">{d.reason}</p>
                </details>
              </>
            ) : (
              <p className="text-xs text-fg-muted">{d.reason}</p>
            )}
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
  )
}
