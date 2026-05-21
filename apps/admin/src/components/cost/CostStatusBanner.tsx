/**
 * FILE: apps/admin/src/components/cost/CostStatusBanner.tsx
 * PURPOSE: LLM spend health — telemetry gaps, spikes, BYOK, failed calls.
 */

import { Link } from 'react-router-dom'
import { Btn, RelativeTime } from '../ui'
import { usePageCopy } from '../../lib/copy'
import { OperationChip } from '../OperationChip'
import type { CostStats, CostTabId } from './types'

interface Props {
  stats: CostStats
  onTab?: (tab: CostTabId) => void
  plainBanner?: boolean
}

function fmtUsd(n: number): string {
  if (n >= 1) return `$${n.toFixed(2)}`
  if (n >= 0.01) return `$${n.toFixed(4)}`
  return `$${n.toFixed(6)}`
}

export function CostStatusBanner({ stats, onTab, plainBanner = false }: Props) {
  const copy = usePageCopy('/cost')
  const actions = copy?.actionLabels ?? {}
  const projectLabel = stats.projectName ?? 'this project'

  if (!stats.projectId) {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-warn/30 bg-warn/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-warn" aria-hidden />
          <div>
            <p className="text-xs font-medium text-warn">
              {plainBanner ? 'Pick a project first' : 'No project selected'}
            </p>
            <p className="text-2xs text-fg-muted">
              {plainBanner
                ? 'AI spend is tracked per app — choose one in the header.'
                : 'LLM cost is per-project — pick an app from the header project switcher before auditing spend.'}
            </p>
          </div>
        </div>
      </div>
    )
  }

  if (stats.totalCalls === 0) {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-info/30 bg-info/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-info" aria-hidden />
          <div>
            <p className="text-xs font-medium text-info">
              {plainBanner ? 'No AI calls logged yet' : `No LLM calls logged yet for ${projectLabel}`}
            </p>
            <p className="text-2xs text-fg-muted">
              {plainBanner
                ? 'Send a test bug or run classify — each step logs tokens and cost here.'
                : 'Ingest a report or run classify/fix — each edge function writes to llm_invocations with token counts and cost_usd.'}
            </p>
          </div>
        </div>
        <Link to="/health">
          <Btn size="sm" variant="ghost">{actions.health ?? 'Run Health test'}</Btn>
        </Link>
      </div>
    )
  }

  if (stats.spendSpike24h) {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-warn/30 bg-warn/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-warn" aria-hidden />
          <div>
            <p className="text-xs font-medium text-warn">
              {plainBanner
                ? `Spend jumped to ${fmtUsd(stats.spend24hUsd)} in 24h`
                : `Spend spike — ${fmtUsd(stats.spend24hUsd)} in 24h vs ${fmtUsd(stats.prior24hSpendUsd)} prior day`}
            </p>
            <p className="text-2xs text-fg-muted">
              {stats.calls24h} calls in 24h
              {stats.topOperation ? (
                <> · top driver: <OperationChip operation={stats.topOperation} maxWidthClass="max-w-[8rem]" /></>
              ) : null}
              {plainBanner ? ' — check the raw log.' : ' — check Raw log for runaway crons.'}
            </p>
          </div>
        </div>
        {onTab ? (
          <Btn size="sm" variant="ghost" onClick={() => onTab('log')}>
            {actions.log ?? 'Inspect log'}
          </Btn>
        ) : null}
      </div>
    )
  }

  if (stats.failedCalls24h > 0) {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-danger/30 bg-danger/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-danger" aria-hidden />
          <div>
            <p className="text-xs font-medium text-danger">
              {plainBanner
                ? `${stats.failedCalls24h} AI call${stats.failedCalls24h === 1 ? '' : 's'} failed in 24h`
                : `${stats.failedCalls24h} failed LLM call${stats.failedCalls24h === 1 ? '' : 's'} in 24h`}
            </p>
            <p className="text-2xs text-fg-muted">
              {plainBanner
                ? 'Failed calls may still cost tokens — open the raw log to investigate.'
                : 'Failed invocations may still incur partial token cost — filter Raw log by operation and check Langfuse traces.'}
            </p>
          </div>
        </div>
        {onTab ? (
          <Btn size="sm" variant="ghost" onClick={() => onTab('log')}>
            {actions.failures ?? 'View failures'}
          </Btn>
        ) : null}
      </div>
    )
  }

  if (!stats.byokAnthropicConfigured && stats.platformKeyCalls24h > 0) {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-warn/30 bg-warn/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-warn" aria-hidden />
          <div>
            <p className="text-xs font-medium text-warn">
              {plainBanner
                ? 'Using Mushi platform keys'
                : `Using platform keys — ${stats.platformKeyCalls24h} call${stats.platformKeyCalls24h === 1 ? '' : 's'} in 24h`}
            </p>
            <p className="text-2xs text-fg-muted">
              {fmtUsd(stats.spend24hUsd)} in 24h on platform keys — add your own Anthropic key in Settings to control billing.
            </p>
          </div>
        </div>
        <Link to="/settings?tab=byok">
          <Btn size="sm" variant="ghost">{actions.byok ?? 'Add BYOK'}</Btn>
        </Link>
      </div>
    )
  }

  if (stats.ledgerCount > 0 && stats.invocationCount === 0) {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-info/30 bg-info/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-info" aria-hidden />
          <div>
            <p className="text-xs font-medium text-info">
              {plainBanner ? 'Legacy cost rows only' : `Legacy ledger only — ${stats.ledgerCount} llm_cost_usd rows`}
            </p>
            <p className="text-2xs text-fg-muted">
              New telemetry writes to llm_invocations. Legacy rows are merged into totals until fully migrated.
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border border-ok/30 bg-ok/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-2 min-w-0">
        <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-ok" aria-hidden />
        <div>
          <p className="text-xs font-medium text-ok">
            {plainBanner ? 'AI spend tracking is active' : `Telemetry active for ${projectLabel}`}
          </p>
          <p className="text-2xs text-fg-muted">
            {fmtUsd(stats.spend24hUsd)} in 24h · {stats.calls24h} calls
            {stats.lastCallAt ? (
              <> · last call <RelativeTime value={stats.lastCallAt} /></>
            ) : null}
            {stats.byokCalls24h > 0 ? ` · ${stats.byokCalls24h} BYOK` : ''}
          </p>
        </div>
      </div>
      {onTab ? (
        <Btn size="sm" variant="ghost" onClick={() => onTab('breakdown')}>
          {actions.breakdown ?? 'View breakdown'}
        </Btn>
      ) : null}
    </div>
  )
}
