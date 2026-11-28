/**
 * FILE: apps/admin/src/components/cost/CostUnpricedPanel.tsx
 * PURPOSE: The calls the shared price book could not price, listed by model
 *          (cost catalog, 2026-11-25). They are kept out of every dollar
 *          total on /cost instead of counting as $0. The platform super-admin
 *          can add the missing price; it writes a kensaurus_price_overrides
 *          row through POST /v1/admin/costs/price-override, and the next call
 *          of that model is priced from it.
 *
 * Shown only when something is unpriced. Dense table, no cards (ADR 0069).
 */

import { useState } from 'react'
import { apiFetch } from '../../lib/supabase'
import { useEntitlements } from '../../lib/useEntitlements'
import { useToast } from '../../lib/toast'
import { Btn, Input } from '../ui'
import { formatRelative } from '../ui/metrics'
import { StatusMark } from '../signal/StatusMark'
import { ResponsiveTable } from '../ResponsiveTable'
import type { CostStats, UnpricedModelRow } from './types'

interface Props {
  stats: Pick<CostStats, 'unpriced' | 'unpricedCalls30d' | 'unpricedCallsOlder'>
  projectId: string
  onPriced?: () => void
}

export function CostUnpricedPanel({ stats, projectId, onPriced }: Props) {
  const { isSuperAdmin } = useEntitlements()
  const [open, setOpen] = useState<string | null>(null)
  const total = stats.unpricedCalls30d + stats.unpricedCallsOlder
  if (total === 0) return null

  return (
    <section aria-labelledby="cost-unpriced-title" className="rounded-md border border-edge bg-surface p-3" data-testid="cost-unpriced">
      <h3 id="cost-unpriced-title" className="flex items-center gap-1.5 text-xs font-semibold text-fg">
        <StatusMark status="slow" />
        {total.toLocaleString()} unpriced call{total === 1 ? '' : 's'}
      </h3>
      <p className="mt-0.5 text-2xs text-fg-secondary">
        The price book has no price for these models, so they are not in any dollar figure on this page.
        {stats.unpricedCallsOlder > 0 ? ` ${stats.unpricedCallsOlder.toLocaleString()} are older than 30 days.` : ''}
      </p>
      {stats.unpriced.length > 0 && (
        <ResponsiveTable ariaLabel="Unpriced calls by model" className="mt-2">
          <table className="w-full text-2xs">
            <thead>
              <tr className="border-b border-edge text-left text-fg-secondary">
                <th className="py-1 pr-2 font-semibold">Model</th>
                <th className="py-1 pr-2 text-right font-semibold">Calls</th>
                <th className="py-1 pr-2 text-right font-semibold">Tokens in / out</th>
                <th className="py-1 pr-2 font-semibold">Last seen</th>
                <th className="py-1 pr-2 font-semibold">Why</th>
                {isSuperAdmin ? <th className="py-1 font-semibold"><span className="sr-only">Add price</span></th> : null}
              </tr>
            </thead>
            <tbody>
              {stats.unpriced.map((row) => (
                <UnpricedRow
                  key={row.model}
                  row={row}
                  canPrice={isSuperAdmin}
                  open={open === row.model}
                  onToggle={() => setOpen(open === row.model ? null : row.model)}
                  projectId={projectId}
                  onPriced={() => {
                    setOpen(null)
                    onPriced?.()
                  }}
                />
              ))}
            </tbody>
          </table>
        </ResponsiveTable>
      )}
      {!isSuperAdmin && (
        <p className="mt-1.5 text-2xs text-fg-muted">Mushi Mushi adds the missing price to the shared price book; calls after that are priced.</p>
      )}
    </section>
  )
}

function UnpricedRow({
  row,
  canPrice,
  open,
  onToggle,
  projectId,
  onPriced,
}: {
  row: UnpricedModelRow
  canPrice: boolean
  open: boolean
  onToggle: () => void
  projectId: string
  onPriced: () => void
}) {
  return (
    <>
      <tr className="border-b border-edge-subtle align-top last:border-0">
        <td className="py-1 pr-2">
          <span className="font-mono text-fg">{row.model}</span>
          <span className="ml-1 text-fg-muted">{row.provider}</span>
        </td>
        <td className="py-1 pr-2 text-right tabular-nums text-fg">{row.calls.toLocaleString()}</td>
        <td className="py-1 pr-2 text-right tabular-nums text-fg-secondary">
          {row.inputTokens.toLocaleString()} / {row.outputTokens.toLocaleString()}
        </td>
        <td className="py-1 pr-2 whitespace-nowrap text-fg-secondary" title={row.lastSeenAt}>{formatRelative(row.lastSeenAt)}</td>
        <td className="py-1 pr-2 text-fg-secondary break-words">{row.reason}</td>
        {canPrice ? (
          <td className="py-1 text-right">
            <Btn size="sm" variant="ghost" onClick={onToggle} aria-expanded={open}>
              {open ? 'Cancel' : 'Add price'}
            </Btn>
          </td>
        ) : null}
      </tr>
      {canPrice && open ? (
        <tr>
          <td colSpan={6} className="pb-2">
            <AddPriceForm row={row} projectId={projectId} onDone={onPriced} />
          </td>
        </tr>
      ) : null}
    </>
  )
}

/** Dollars per 1M tokens, as the provider's pricing page states them. */
function AddPriceForm({ row, projectId, onDone }: { row: UnpricedModelRow; projectId: string; onDone: () => void }) {
  const toast = useToast()
  const [input, setInput] = useState('')
  const [output, setOutput] = useState('')
  const [cached, setCached] = useState('')
  const [sourceUrl, setSourceUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const num = (s: string) => (s.trim() === '' ? null : Number(s))
  const submit = async () => {
    setBusy(true)
    setError(null)
    const res = await apiFetch<{ override: unknown }>(`/v1/admin/costs/price-override?project_id=${encodeURIComponent(projectId)}`, {
      method: 'POST',
      body: JSON.stringify({
        provider: row.provider,
        model: row.model,
        input_usd_per_mtok: num(input),
        output_usd_per_mtok: num(output),
        cached_input_usd_per_mtok: num(cached),
        source_url: sourceUrl.trim() || null,
      }),
    })
    setBusy(false)
    if (!res.ok) {
      setError(res.error?.message ?? 'The price was not saved.')
      return
    }
    toast.success(`${row.model} has a price now.`, 'New calls use it within about ten minutes; calls already logged stay unpriced.')
    onDone()
  }

  return (
    <form
      className="flex flex-wrap items-end gap-2 rounded-sm border border-edge-subtle bg-surface-raised p-2"
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
      aria-label={`Add a price for ${row.model}`}
    >
      <label className="flex flex-col gap-0.5 text-2xs text-fg-secondary">
        Input $ / 1M tokens
        <Input inputMode="decimal" required value={input} onChange={(e) => setInput(e.target.value)} className="w-24" />
      </label>
      <label className="flex flex-col gap-0.5 text-2xs text-fg-secondary">
        Output $ / 1M tokens
        <Input inputMode="decimal" required value={output} onChange={(e) => setOutput(e.target.value)} className="w-24" />
      </label>
      <label className="flex flex-col gap-0.5 text-2xs text-fg-secondary">
        Cache read $ / 1M (optional)
        <Input inputMode="decimal" value={cached} onChange={(e) => setCached(e.target.value)} className="w-24" />
      </label>
      <label className="flex min-w-48 flex-1 flex-col gap-0.5 text-2xs text-fg-secondary">
        Pricing page (https)
        <Input type="url" value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} placeholder="https://…" />
      </label>
      <Btn size="sm" type="submit" loading={busy} disabled={busy || !input.trim() || !output.trim()}>
        Save price
      </Btn>
      {error ? <p role="alert" className="w-full text-2xs text-st-failed-ink">{error}</p> : null}
      <p className="w-full text-2xs text-fg-muted">Applies to every KENSAURUS app, from the next price refresh (about ten minutes). Calls already logged stay unpriced.</p>
    </form>
  )
}
