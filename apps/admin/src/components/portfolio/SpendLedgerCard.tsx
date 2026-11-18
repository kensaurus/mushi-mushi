/**
 * SpendLedgerCard — what each app costs over 30 days (gap #22): Mushi's own
 * AI calls, your AI provider spend, CI minutes as cost (estimated), and the
 * Supabase, Vercel and AWS bills you import. A source that could not be read
 * says so and is left out of the total; it never shows as $0.
 *
 * Signal pass (2026-11-18): apps sort by total, which is a bar beside its number, and a
 * stacked bar per app shows where the money goes (one legend for all of them). A source with
 * nothing connected is a hatched "—" cell, not "Not connected" in every row; its column header
 * carries ONE connect action instead.
 *
 * Data: GET    /v1/admin/orgs/:orgId/spend
 *       POST   /v1/admin/orgs/:orgId/spend/imports            (owners and admins)
 *       DELETE /v1/admin/orgs/:orgId/spend/imports/:importId  (owners and admins; the import's
 *              days go back to the next newest import that has them)
 */

import { useRef, useState } from 'react'
import { Btn, Callout, Loading, Section } from '../ui'
import { usePageData } from '../../lib/usePageData'
import { apiFetchMutate } from '../../lib/supabase'
import { actionErrorText } from '../../lib/actionErrorText'
import { ORG_ADMIN_ONLY_HINT, useOrgCanManage } from '../../lib/useOrgCanManage'
import { ConfirmDialog } from '../ConfirmDialog'
import { PageLoadError } from '../PageLoadError'
import type { BillImportResult, BillRemovalResult, BillVendor, LedgerSource, SpendLedgerResponse } from '../../lib/portfolioTypes'
import { formatUsd } from './portfolioView'
import { billsBreakdown, importSummary, ledgerCell, ledgerTotal, notConnectedCount, removalSummary, sortBySpend, SPEND_PARTS, spendSplit, supabaseUsage, vendorLabel, type SpendPart } from './spendView'
import { BarCell } from '../signal/BarCell'
import { ProjectFavicon } from '../ProjectFavicon'
import type { IconFor } from './AppIconChips'

const VENDORS: BillVendor[] = ['vercel', 'aws', 'supabase', 'other']
const SELECT = 'rounded-sm border border-edge bg-surface-root px-2 py-1 text-xs'

const TD = 'px-2 py-1 text-right font-mono tabular-nums'

function Cell({ source, title }: { source: LedgerSource; title?: string }) {
  const c = ledgerCell(source)
  // Nothing connected: a hatched dash, the reason in the tooltip; the header has the action.
  if (c.tone === 'muted') {
    return (
      <td className={`${TD} ci-nodata text-fg-muted`} title={c.title ? `${c.text}. ${c.title}` : c.text} data-state="not_connected">
        —
      </td>
    )
  }
  const tone = c.tone === 'danger' ? 'font-semibold text-st-failed-ink' : 'text-fg'
  return <td className={`${TD} ${tone}`} title={title ?? c.title}>{c.text}</td>
}

/** The four spend kinds: a fill and a legend glyph each, so the split never relies on colour. */
const PART_STYLE: Record<SpendPart['key'], { fill: string; ink: string; glyph: string }> = {
  mushi: { fill: 'bg-st-running', ink: 'text-st-running', glyph: '■' },
  provider: { fill: 'bg-viz-heat-4', ink: 'text-viz-heat-4', glyph: '●' },
  ci: { fill: 'bg-st-slow', ink: 'text-st-slow', glyph: '▲' },
  cloud: { fill: 'bg-fg-secondary', ink: 'text-fg-secondary', glyph: '◆' },
}

/** One app's spend as a stacked bar; the amounts are its accessible name. */
function SplitBar({ name, parts }: { name: string; parts: readonly SpendPart[] }) {
  const total = parts.reduce((n, p) => n + p.usd, 0)
  const label = `${name} spend: ${parts.map((p) => `${p.label} ${formatUsd(p.usd)}`).join(', ')}`
  return (
    <span role="img" aria-label={label} title={label} className="flex h-2 w-24 overflow-hidden rounded-full bg-surface-overlay" data-testid="spend-split">
      {total > 0 &&
        parts
          .filter((p) => p.usd > 0)
          .map((p) => <span key={p.key} className={`ci-grow-x h-full ${PART_STYLE[p.key].fill}`} style={{ width: `${(p.usd / total) * 100}%` }} data-part={p.key} />)}
    </span>
  )
}

/** A column header with, when some app has nothing connected there, ONE action to connect it. */
function ConnectHeader({ label, title, missing, action }: { label: string; title?: string; missing: number; action: { text: string; onClick?: () => void; to?: string } }) {
  return (
    <th scope="col" className="px-2 py-1 text-right align-bottom text-2xs font-semibold text-fg-secondary" title={title}>
      <span className="block">{label}</span>
      {missing > 0 && (
        <Btn size="sm" variant="ghost" className="mt-0.5 whitespace-nowrap" to={action.to} onClick={action.onClick} title={`${missing} app${missing === 1 ? '' : 's'} with nothing connected here`}>
          {action.text}
        </Btn>
      )}
    </th>
  )
}

export function SpendLedgerCard({ orgId, projects, iconFor }: { orgId: string; projects: Array<{ projectId: string; name: string }>; iconFor?: IconFor }) {
  const path = `/v1/admin/orgs/${orgId}/spend`
  const { data, loading, error, reload } = usePageData<SpendLedgerResponse>(path)
  const [vendor, setVendor] = useState<BillVendor>('vercel')
  const [target, setTarget] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ tone: 'info' | 'danger'; text: string } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  // Importing and removing bills is for owners and admins (QA 177); a
  // removal asks first, since it drops an imported bill (QA 44).
  const { canManage } = useOrgCanManage(orgId)
  const [confirmRemove, setConfirmRemove] = useState<{ id: string; label: string } | null>(null)

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
      if (!res.ok || !res.data) setNotice({ tone: 'danger', text: actionErrorText(res.error, 'The bill could not be imported.') })
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
      const res = await apiFetchMutate<BillRemovalResult>(`${path}/imports/${importId}`, { method: 'DELETE' })
      setNotice(res.ok && res.data
        ? { tone: 'info', text: removalSummary(res.data) }
        : { tone: 'danger', text: actionErrorText(res.error, 'The import could not be removed.') })
    } finally {
      setBusy(false)
      reload()
    }
  }

  const name = (id: string | null) => (id ? projects.find((p) => p.projectId === id)?.name ?? id.slice(0, 8) : 'by app column')
  const importRef = useRef<HTMLFieldSetElement>(null)
  // The import form, a vendor picked, in view: where "Connect Supabase" and "Import bills" lead.
  const openImport = (v: BillVendor) => {
    setVendor(v)
    importRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'center' })
    fileRef.current?.focus()
  }
  const openConnectors = () => document.getElementById('portfolio-connectors')?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
  const apps = data ? sortBySpend(data.apps) : []
  const maxTotal = apps.reduce((m, a) => Math.max(m, a.totalUsd), 0)

  return (
    <Section title="Spend per app (30 days)">
      {error && <PageLoadError error={error} resource="spend per app" endpoint={path} onRetry={reload} />}
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
          {apps.length === 0 ? (
            <p className="text-sm text-fg-muted">No apps to show.</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              <ul className="flex flex-wrap gap-x-3 gap-y-0.5 text-2xs text-fg-secondary" aria-hidden="true" data-testid="spend-legend">
                {SPEND_PARTS.map((p) => (
                  <li key={p.key} className="inline-flex items-center gap-1">
                    <span className={`leading-none ${PART_STYLE[p.key].ink}`}>{PART_STYLE[p.key].glyph}</span>
                    {p.label}
                  </li>
                ))}
              </ul>
              {/* Scrolls in its own box at 390 px; `relative` keeps the sr-only text inside it too. */}
              <div className="relative min-w-0 overflow-x-auto" data-testid="spend-ledger-scroll">
                <table className="w-full min-w-160 text-xs" data-testid="spend-ledger-table">
                  <caption className="sr-only">Spend per app over 30 days, most first</caption>
                  <thead>
                    <tr className="border-b border-edge">
                      <th scope="col" className="px-2 py-1 text-left align-bottom text-2xs font-semibold text-fg-secondary">App</th>
                      <th scope="col" className="px-2 py-1 text-right align-bottom text-2xs font-semibold text-fg-secondary">Mushi Mushi AI</th>
                      <ConnectHeader label="AI provider" missing={notConnectedCount(apps, 'providerLlm')} action={{ text: 'Connect AI provider', onClick: openConnectors }} />
                      <ConnectHeader
                        label="CI (est.)"
                        title={`Estimated from job times at $${data.ciUsdPerLinuxMinute} per Linux minute, macOS counted 10×.`}
                        missing={notConnectedCount(apps, 'ci')}
                        action={{ text: 'Connect GitHub', to: '/integrations' }}
                      />
                      {/* Both lead to the bill import, which only owners and admins see. */}
                      <ConnectHeader label="Supabase" missing={canManage === false ? 0 : notConnectedCount(apps, 'supabase')} action={{ text: 'Connect Supabase', onClick: () => openImport('supabase') }} />
                      <ConnectHeader label="Other bills" missing={canManage === false ? 0 : notConnectedCount(apps, 'bills')} action={{ text: 'Import bills', onClick: () => openImport('vercel') }} />
                      <th scope="col" className="px-2 py-1 text-right align-bottom text-2xs font-semibold text-fg-secondary">Total</th>
                      <th scope="col" className="px-2 py-1 text-left align-bottom text-2xs font-semibold text-fg-secondary">Where it goes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {apps.map((a) => {
                      const total = ledgerTotal(a)
                      return (
                        <tr key={a.projectId} className="ci-rise border-b border-edge-subtle hover:bg-surface-overlay/60">
                          <td className="max-w-48 px-2 py-1 font-semibold text-fg">
                            <span className="flex min-w-0 items-center gap-1.5">
                              {iconFor && <ProjectFavicon {...iconFor(a.projectId)} size={12} />}
                              <span className="truncate">{a.name}</span>
                            </span>
                          </td>
                          <Cell source={a.mushiLlm} title={`${a.mushiLlm.calls} AI call${a.mushiLlm.calls === 1 ? '' : 's'}${a.mushiLlm.detail ? `. ${a.mushiLlm.detail}` : ''}`} />
                          <Cell source={a.providerLlm} />
                          <Cell source={a.ci} title={a.ci.state === 'ok' ? `${a.ci.minutes ?? 0} billable minutes over ${a.ci.runs} runs. ${a.ci.detail ?? ''}` : undefined} />
                          <Cell source={a.supabase} title={supabaseUsage(a)} />
                          <Cell source={a.bills} title={billsBreakdown(a)} />
                          <td className="px-2 py-1 text-right" title={total.title} data-testid="spend-total">
                            <BarCell
                              value={a.totalUsd}
                              max={maxTotal}
                              tone="neutral"
                              text={total.tone ? <span className="text-st-waiting-ink">{total.text}</span> : total.text}
                              className="justify-end"
                            />
                          </td>
                          <td className="px-2 py-1">
                            <SplitBar name={a.name} parts={spendSplit(a)} />
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="font-mono text-fg-secondary">
                      <td className="px-2 py-1 font-sans font-semibold">All apps</td>
                      <td className={TD}>{formatUsd(data.totals.mushiLlmUsd)}</td>
                      <td className={TD}>{formatUsd(data.totals.providerLlmUsd)}</td>
                      <td className={TD}>{formatUsd(data.totals.ciUsd)}</td>
                      <td className={TD}>{formatUsd(data.totals.supabaseUsd)}</td>
                      <td className={TD}>{formatUsd(data.totals.billsUsd)}</td>
                      <td className={`${TD} font-bold text-fg`}>{formatUsd(data.totals.totalUsd)}{data.complete ? '' : '+'}</td>
                      <td className="px-2 py-1">
                        <SplitBar
                          name="All apps"
                          parts={SPEND_PARTS.map((p) => ({
                            ...p,
                            usd: p.key === 'mushi' ? data.totals.mushiLlmUsd : p.key === 'provider' ? data.totals.providerLlmUsd : p.key === 'ci' ? data.totals.ciUsd : data.totals.supabaseUsd + data.totals.billsUsd,
                          }))}
                        />
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}
          {data.unattributedProviderUsd !== null && data.unattributedProviderUsd > 0 && (
            <p className="text-xs text-fg-muted">
              {formatUsd(data.unattributedProviderUsd)} of AI provider spend is not tied to any app. Give each app its own OpenAI project or Anthropic workspace to see it here.
            </p>
          )}

          {canManage === false ? (
            <p className="text-xs text-fg-muted">Importing a bill: {ORG_ADMIN_ONLY_HINT}</p>
          ) : (
          <fieldset ref={importRef} id="spend-import" className="flex flex-col gap-2 rounded-md border border-edge-subtle p-3 text-xs" disabled={busy}>
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
          )}

          {data.imports.length > 0 && (
            <div className="flex flex-col gap-1">
              <p className="text-xs font-medium text-fg">Recent imports</p>
              <p className="text-xs text-fg-muted">
                A newer import of the same days replaces the older figures. Removing it puts the older import's figures back.
              </p>
              <ul className="flex flex-col divide-y divide-edge-subtle text-xs">
                {data.imports.map((i) => (
                  <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                    <span className="text-fg-secondary">
                      {vendorLabel(i.vendor)} · {name(i.projectId)} · {formatUsd(i.totalUsd)}
                      {i.periodStart && i.periodEnd ? ` · ${i.periodStart} to ${i.periodEnd}` : ''}
                      {i.filename ? ` · ${i.filename}` : ''}
                      {i.rowsSkipped > 0 ? ` · ${i.rowsSkipped} skipped` : ''}
                    </span>
                    {canManage !== false && (
                      <Btn
                        size="sm"
                        variant="ghost"
                        onClick={() => setConfirmRemove({ id: i.id, label: `${vendorLabel(i.vendor)} bill for ${name(i.projectId)}` })}
                        disabled={busy}
                      >
                        Remove
                      </Btn>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      {confirmRemove && (
        <ConfirmDialog
          title="Remove this imported bill?"
          body={`The ${confirmRemove.label} leaves the spend table. Days that an older import also covers go back to that import's figures. To undo, import the file again.`}
          confirmLabel="Remove bill"
          tone="danger"
          loading={busy}
          onCancel={() => setConfirmRemove(null)}
          onConfirm={async () => {
            await remove(confirmRemove.id)
            setConfirmRemove(null)
          }}
        />
      )}
    </Section>
  )
}
