/**
 * SpendLedgerCard — what each app costs over 30 days (gap #22): Mushi's own
 * AI calls, your AI provider spend, CI minutes as cost (estimated), and the
 * Supabase, Vercel and AWS bills you import. A source that could not be read
 * says so and is left out of the total; it never shows as $0.
 *
 * Data: GET    /v1/admin/orgs/:orgId/spend
 *       POST   /v1/admin/orgs/:orgId/spend/imports            (owners and admins)
 *       DELETE /v1/admin/orgs/:orgId/spend/imports/:importId  (owners and admins)
 */

import { useRef, useState } from 'react'
import { Badge, Btn, Callout, ErrorAlert, Loading, Section } from '../ui'
import { usePageData } from '../../lib/usePageData'
import { apiFetchMutate } from '../../lib/supabase'
import type { BillImportResult, BillVendor, LedgerSource, SpendLedgerResponse } from '../../lib/portfolioTypes'
import { formatUsd } from './portfolioView'
import { billsBreakdown, importSummary, ledgerCell, ledgerTotal, supabaseUsage, vendorLabel } from './spendView'

const VENDORS: BillVendor[] = ['vercel', 'aws', 'supabase', 'other']
const SELECT = 'rounded-sm border border-edge bg-surface-root px-2 py-1 text-xs'

function Cell({ source, title }: { source: LedgerSource; title?: string }) {
  const c = ledgerCell(source)
  const tone = c.tone === 'danger' ? 'text-danger' : c.tone === 'muted' ? 'text-fg-faint' : 'text-fg'
  return <td className={`px-2 py-1.5 text-right tabular-nums ${tone}`} title={title ?? c.title}>{c.text}</td>
}

export function SpendLedgerCard({ orgId, projects }: { orgId: string; projects: Array<{ projectId: string; name: string }> }) {
  const path = `/v1/admin/orgs/${orgId}/spend`
  const { data, loading, error, reload } = usePageData<SpendLedgerResponse>(path)
  const [vendor, setVendor] = useState<BillVendor>('vercel')
  const [target, setTarget] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ tone: 'info' | 'danger'; text: string } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const upload = async () => {
    const file = fileRef.current?.files?.[0]
    if (!file) {
      setNotice({ tone: 'danger', text: 'Pick a CSV file first.' })
      return
    }
    setBusy(true)
    setNotice(null)
    try {
      const csv = await file.text()
      const res = await apiFetchMutate<BillImportResult>(`${path}/imports`, {
        method: 'POST',
        body: JSON.stringify({ vendor, projectId: target || null, filename: file.name.slice(0, 200), csv }),
      })
      if (!res.ok || !res.data) setNotice({ tone: 'danger', text: res.error?.message ?? 'The bill could not be imported.' })
      else {
        setNotice({ tone: 'info', text: importSummary(res.data) })
        if (fileRef.current) fileRef.current.value = ''
      }
    } finally {
      setBusy(false)
      reload()
    }
  }

  const remove = async (importId: string) => {
    setBusy(true)
    setNotice(null)
    try {
      const res = await apiFetchMutate<{ importId: string }>(`${path}/imports/${importId}`, { method: 'DELETE' })
      setNotice(res.ok ? { tone: 'info', text: 'Import removed.' } : { tone: 'danger', text: res.error?.message ?? 'The import could not be removed.' })
    } finally {
      setBusy(false)
      reload()
    }
  }

  const name = (id: string | null) => (id ? projects.find((p) => p.projectId === id)?.name ?? id.slice(0, 8) : 'by app column')

  return (
    <Section title="Spend per app (30 days)">
      <p className="mb-3 text-xs text-fg-muted">
        What each app costs: Mushi's own AI, your AI provider bill, CI minutes and the cloud bills you import. CI is estimated from job times at ${data?.ciUsdPerLinuxMinute ?? 0.006} per Linux minute, macOS counted 10×.
      </p>
      {error && <ErrorAlert message={error} endpoint={path} onRetry={reload} />}
      {loading && !data && <Loading text="Adding up what each app costs…" />}
      {notice && (
        <Callout tone={notice.tone}>
          <span role="status">{notice.text}</span>
        </Callout>
      )}
      {data && (
        <div className="flex flex-col gap-3">
          {!data.complete && (
            <Callout tone="warn">
              <span role="status">A source could not be read, so some totals are a floor, not the full spend. Hover a cell for the reason.</span>
            </Callout>
          )}
          {data.apps.length === 0 ? (
            <p className="text-sm text-fg-muted">No apps to show.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-xs" data-testid="spend-ledger-table">
                <thead>
                  <tr className="border-b border-edge text-fg-muted">
                    <th className="px-2 py-1.5 text-left font-medium">App</th>
                    <th className="px-2 py-1.5 text-right font-medium">Mushi AI</th>
                    <th className="px-2 py-1.5 text-right font-medium">AI provider</th>
                    <th className="px-2 py-1.5 text-right font-medium">CI (est.)</th>
                    <th className="px-2 py-1.5 text-right font-medium">Supabase</th>
                    <th className="px-2 py-1.5 text-right font-medium">Other bills</th>
                    <th className="px-2 py-1.5 text-right font-medium">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {data.apps.map((a) => {
                    const total = ledgerTotal(a)
                    return (
                      <tr key={a.projectId} className="border-b border-edge-subtle">
                        <td className="max-w-[12rem] truncate px-2 py-1.5 font-medium text-fg">{a.name}</td>
                        <Cell source={a.mushiLlm} title={`${a.mushiLlm.calls} AI call${a.mushiLlm.calls === 1 ? '' : 's'}${a.mushiLlm.detail ? `. ${a.mushiLlm.detail}` : ''}`} />
                        <Cell source={a.providerLlm} />
                        <Cell source={a.ci} title={a.ci.state === 'ok' ? `${a.ci.minutes ?? 0} billable minutes over ${a.ci.runs} runs. ${a.ci.detail ?? ''}` : undefined} />
                        <Cell source={a.supabase} title={supabaseUsage(a)} />
                        <Cell source={a.bills} title={billsBreakdown(a)} />
                        <td className="px-2 py-1.5 text-right font-semibold tabular-nums text-fg" title={total.title}>
                          {total.tone ? <Badge tone={total.tone}>{total.text}</Badge> : total.text}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className="text-fg-muted">
                    <td className="px-2 py-1.5 font-medium">All apps</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{formatUsd(data.totals.mushiLlmUsd)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{formatUsd(data.totals.providerLlmUsd)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{formatUsd(data.totals.ciUsd)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{formatUsd(data.totals.supabaseUsd)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{formatUsd(data.totals.billsUsd)}</td>
                    <td className="px-2 py-1.5 text-right font-semibold tabular-nums text-fg">{formatUsd(data.totals.totalUsd)}{data.complete ? '' : '+'}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
          {data.unattributedProviderUsd !== null && data.unattributedProviderUsd > 0 && (
            <p className="text-xs text-fg-muted">
              {formatUsd(data.unattributedProviderUsd)} of AI provider spend is not tied to any app. Give each app its own OpenAI project or Anthropic workspace to see it here.
            </p>
          )}

          <fieldset className="flex flex-col gap-2 rounded-md border border-edge-subtle p-3 text-xs" disabled={busy}>
            <legend className="px-1 text-xs font-medium text-fg">Import a bill</legend>
            <p className="text-fg-muted">
              A FOCUS export from Vercel or AWS, an AWS Cost and Usage Report, or any CSV with date, service and cost columns. Importing the same bill again replaces those days. Owners and admins only.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-1">
                <span className="text-fg-muted">From</span>
                <select className={SELECT} value={vendor} onChange={(e) => setVendor(e.target.value as BillVendor)}>
                  {VENDORS.map((v) => <option key={v} value={v}>{vendorLabel(v)}</option>)}
                </select>
              </label>
              <label className="flex items-center gap-1">
                <span className="text-fg-muted">For</span>
                <select className={SELECT} value={target} onChange={(e) => setTarget(e.target.value)}>
                  <option value="">Each row's app column</option>
                  {projects.map((p) => <option key={p.projectId} value={p.projectId}>{p.name}</option>)}
                </select>
              </label>
              <input ref={fileRef} type="file" accept=".csv,text/csv" aria-label="Bill CSV file" className="text-xs" />
              <Btn size="sm" variant="ghost" onClick={upload} loading={busy} disabled={busy}>Import</Btn>
            </div>
          </fieldset>

          {data.imports.length > 0 && (
            <div className="flex flex-col gap-1">
              <p className="text-xs font-medium text-fg">Recent imports</p>
              <ul className="flex flex-col divide-y divide-edge-subtle text-xs">
                {data.imports.map((i) => (
                  <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                    <span className="text-fg-secondary">
                      {vendorLabel(i.vendor)} · {name(i.projectId)} · {formatUsd(i.totalUsd)}
                      {i.periodStart && i.periodEnd ? ` · ${i.periodStart} to ${i.periodEnd}` : ''}
                      {i.filename ? ` · ${i.filename}` : ''}
                      {i.rowsSkipped > 0 ? ` · ${i.rowsSkipped} skipped` : ''}
                    </span>
                    <Btn size="sm" variant="ghost" onClick={() => remove(i.id)} disabled={busy}>Remove</Btn>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Section>
  )
}
