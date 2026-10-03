/**
 * StorePanel — the store review for one app (Plan 020 §5): the listing in
 * the repo against what is live, listing claims against the code, iOS
 * screenshots, and the pre-submission checklist. Read-only; a listing change
 * goes out as a draft PR that your own CI publishes.
 *
 * Data: GET  /v1/admin/projects/:id/store
 *       POST /v1/admin/projects/:id/store/review (1 per 30 min; may use your AI key)
 */

import { useState } from 'react'
import { Badge, Btn, Callout, CopyButton, ErrorAlert, Loading, Section, type BadgeTone } from '../ui'
import { usePageData } from '../../lib/usePageData'
import { apiFetchMutate } from '../../lib/supabase'
import { radarStateMeta } from './portfolioView'

interface StoreStatus {
  checkedAt: string | null
  status: string
  results: Array<{ ruleId: string; state: string; reason: string; findings: number }>
  checklist: { items: Array<{ id: string; title: string; risk: string; reason: string; fix: string | null }>; releaseRisk: string; note: string } | null
  findings: Array<{ id: string; severity: string; rule_id: string; message: string; suggested_fix: { fix?: string } | null }>
  note: string
}

const TITLES: Record<string, string> = {
  listing_drift: 'Listing in the repo matches what is live',
  listing_locale_out_of_sync: 'Same languages in the repo and live',
  listing_limit_exceeded: 'Within the store length limits',
  listing_claim_contradicts_code: 'Listing claims match the code',
  privacy_label_mismatch: 'Privacy labels match the SDKs',
  screenshot_platform_mismatch: 'iOS screenshots are iPhone or iPad shaped',
  screenshot_stale: 'Screenshots are recent',
}

const RISK: Record<string, { label: string; tone: BadgeTone }> = {
  high: { label: 'High risk', tone: 'dangerSubtle' },
  medium: { label: 'Medium risk', tone: 'warnSubtle' },
  low: { label: 'Low risk', tone: 'okSubtle' },
  unknown: { label: 'Not checked', tone: 'neutral' },
}

export function StorePanel({ projectId }: { projectId: string }) {
  const path = `/v1/admin/projects/${projectId}/store`
  const { data, loading, error, reload } = usePageData<StoreStatus>(path)
  const [running, setRunning] = useState(false)
  const [notice, setNotice] = useState<{ tone: 'info' | 'danger'; text: string } | null>(null)

  const run = async () => {
    setRunning(true)
    setNotice(null)
    try {
      const res = await apiFetchMutate(`${path}/review`, { method: 'POST', body: '{}' })
      setNotice(res.ok ? { tone: 'info', text: 'Store review done.' } : { tone: 'danger', text: res.error?.message ?? 'The store review did not run.' })
    } finally {
      setRunning(false)
      reload()
    }
  }

  return (
    <Section title="Store review" action={<Btn size="sm" variant="ghost" onClick={run} loading={running} disabled={running}>Run store review</Btn>}>
      <p className="mb-3 text-xs text-fg-muted">Checks your store listing against your code and against what is live, before a reviewer does. A check against the code, not legal advice.</p>
      {notice && (
        <Callout tone={notice.tone}>
          <span role="status">{notice.text}</span>
        </Callout>
      )}
      {error && <ErrorAlert message={error} endpoint={path} onRetry={reload} />}
      {loading && !data && <Loading text="Reading the store review…" />}
      {data && data.status === 'never_run' && <p className="text-sm text-fg-muted">Not checked yet.</p>}
      {data && data.status !== 'never_run' && (
        <div className="flex flex-col gap-3">
          <ul className="flex flex-col divide-y divide-edge-subtle">
            {data.results.map((r) => {
              const meta = radarStateMeta(r.state)
              return (
                <li key={r.ruleId} className="flex flex-col gap-1 py-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-medium text-fg">{TITLES[r.ruleId] ?? r.ruleId}</span>
                    <Badge tone={meta.tone}>{meta.label}</Badge>
                  </div>
                  <p className="text-xs text-fg-muted">{r.reason}</p>
                  {data.findings.filter((f) => f.rule_id === r.ruleId).map((f) => (
                    <div key={f.id} className="flex flex-col gap-1 rounded-md border border-edge-subtle p-2 text-xs sm:flex-row sm:items-start sm:justify-between">
                      <span className="min-w-0 text-fg">{f.message}</span>
                      {f.suggested_fix?.fix && <CopyButton value={`${f.message}\n\nFix: ${f.suggested_fix.fix}`} label="Copy fix prompt" />}
                    </div>
                  ))}
                </li>
              )
            })}
          </ul>
          {data.checklist && (
            <div>
              <p className="mb-1 text-xs font-medium text-fg">Before you submit <Badge tone={(RISK[data.checklist.releaseRisk] ?? RISK.unknown).tone} className="ml-1">{(RISK[data.checklist.releaseRisk] ?? RISK.unknown).label}</Badge></p>
              <ul className="flex flex-col gap-1 text-xs">
                {data.checklist.items.map((i) => (
                  <li key={i.id} className="flex flex-wrap gap-2">
                    <Badge tone={(RISK[i.risk] ?? RISK.unknown).tone}>{(RISK[i.risk] ?? RISK.unknown).label}</Badge>
                    <span className="text-fg">{i.title}:</span>
                    <span className="text-fg-muted">{i.reason}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-2xs text-fg-faint">{data.checklist.note}</p>
            </div>
          )}
        </div>
      )}
    </Section>
  )
}
