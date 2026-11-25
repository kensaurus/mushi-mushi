/**
 * FILE: apps/admin/src/components/cost/vendorCheck.ts
 * PURPOSE: The words CostVendorCheck shows per provider. Pure.
 */

import type { RunStatus } from '../signal/StatusMark'
import { formatSpendUsd } from '../../lib/costView'
import type { CostReconciliation, ReconcileRow } from './types'

const PROVIDER_LABEL: Record<string, string> = { openai: 'OpenAI', anthropic: 'Anthropic' }

const STATUS: Record<ReconcileRow['status'], { mark: RunStatus; label: string }> = {
  ok: { mark: 'passed', label: 'Matches' },
  gap: { mark: 'failed', label: 'Differs' },
  skipped: { mark: 'idle', label: 'Not checked' },
  error: { mark: 'failed', label: 'Could not read' },
}

const SKIP_REASON: Record<string, string> = {
  no_admin_key: 'the connector has no admin key',
  nothing_bound: 'no app is bound to a provider project or workspace',
  not_read_yet: 'the cost report has not been read yet (daily, 03:35 UTC)',
  snapshot_older_than_day: 'the last cost report read is older than the day',
}

/** One line per provider: the latest day checked, or why it is not checked. Pure. */
export function vendorCheckLines(data: CostReconciliation): Array<{ provider: string; status: RunStatus; text: string }> {
  return data.providers.map((p) => {
    const label = PROVIDER_LABEL[p.provider] ?? p.provider
    if (!p.hasAdminKey) {
      return { provider: p.provider, status: 'idle' as const, text: `${label}: not checked, no admin key${p.connected ? ' on its connector' : ''}.` }
    }
    const latest = data.rows.find((r) => r.provider === p.provider)
    if (!latest) return { provider: p.provider, status: 'waiting' as const, text: `${label}: no check yet. It runs daily after the cost report is read.` }
    const s = STATUS[latest.status]
    if (latest.status === 'skipped') {
      const why = SKIP_REASON[String(latest.detail?.reason ?? '')] ?? String(latest.detail?.reason ?? 'skipped')
      return { provider: p.provider, status: s.mark, text: `${label} ${latest.day}: not checked, ${why}.` }
    }
    if (latest.status === 'error') {
      return { provider: p.provider, status: s.mark, text: `${label} ${latest.day}: ${String(latest.detail?.reason ?? 'the cost report could not be read')}.` }
    }
    const gap = latest.gap_pct == null ? '' : ` (${Number(latest.gap_pct) > 0 ? '+' : ''}${Number(latest.gap_pct).toFixed(1)}%)`
    const unpriced = latest.ledger_unpriced_calls > 0 ? `, ${latest.ledger_unpriced_calls} unpriced` : ''
    return {
      provider: p.provider,
      status: s.mark,
      text: `${label} ${latest.day}: billed ${formatSpendUsd(Number(latest.vendor_usd ?? 0))}, recorded ${formatSpendUsd(Number(latest.ledger_usd ?? 0))}${gap}${unpriced}.`,
    }
  })
}
