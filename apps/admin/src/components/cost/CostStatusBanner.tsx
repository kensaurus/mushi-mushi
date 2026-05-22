/**
 * FILE: apps/admin/src/components/cost/CostStatusBanner.tsx
 * PURPOSE: LLM spend health — telemetry gaps, spikes, BYOK, failed calls.
 */

import { Link } from 'react-router-dom'
import { Btn, RelativeTime } from '../ui'
import { usePageCopy } from '../../lib/copy'
import { OperationChip } from '../OperationChip'
import { StatusBannerShell } from '../StatusBannerShell'
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
      <StatusBannerShell
        tone="warn"
        title={plainBanner ? 'Pick a project first' : 'No project selected'}
        subtitle={
          plainBanner
            ? 'AI spend is tracked per app — choose one in the header.'
            : 'LLM cost is per-project — pick an app from the header project switcher before auditing spend.'
        }
      />
    )
  }

  if (stats.totalCalls === 0) {
    return (
      <StatusBannerShell
        tone="info"
        title={plainBanner ? 'No AI calls logged yet' : `No LLM calls logged yet for ${projectLabel}`}
        subtitle={
          plainBanner
            ? 'Send a test bug or run classify — each step logs tokens and cost here.'
            : 'Ingest a report or run classify/fix — each edge function writes to llm_invocations with token counts and cost_usd.'
        }
        action={
          <Link to="/health">
            <Btn size="sm" variant="ghost">{actions.health ?? 'Run Health test'}</Btn>
          </Link>
        }
      />
    )
  }

  if (stats.spendSpike24h) {
    return (
      <StatusBannerShell
        tone="warn"
        title={
          plainBanner
            ? `Spend jumped to ${fmtUsd(stats.spend24hUsd)} in 24h`
            : `Spend spike — ${fmtUsd(stats.spend24hUsd)} in 24h vs ${fmtUsd(stats.prior24hSpendUsd)} prior day`
        }
        subtitle={
          <>
            {stats.calls24h} calls in 24h
            {stats.topOperation ? (
              <> · top driver: <OperationChip operation={stats.topOperation} maxWidthClass="max-w-[8rem]" /></>
            ) : null}
            {plainBanner ? ' — check the raw log.' : ' — check Raw log for runaway crons.'}
          </>
        }
        action={
          onTab ? (
            <Btn size="sm" variant="ghost" onClick={() => onTab('log')}>
              {actions.log ?? 'Inspect log'}
            </Btn>
          ) : null
        }
      />
    )
  }

  if (stats.failedCalls24h > 0) {
    return (
      <StatusBannerShell
        tone="danger"
        title={
          plainBanner
            ? `${stats.failedCalls24h} AI call${stats.failedCalls24h === 1 ? '' : 's'} failed in 24h`
            : `${stats.failedCalls24h} failed LLM call${stats.failedCalls24h === 1 ? '' : 's'} in 24h`
        }
        subtitle={
          plainBanner
            ? 'Failed calls may still cost tokens — open the raw log to investigate.'
            : 'Failed invocations may still incur partial token cost — filter Raw log by operation and check Langfuse traces.'
        }
        action={
          onTab ? (
            <Btn size="sm" variant="ghost" onClick={() => onTab('log')}>
              {actions.failures ?? 'View failures'}
            </Btn>
          ) : null
        }
      />
    )
  }

  if (!stats.byokAnthropicConfigured && stats.platformKeyCalls24h > 0) {
    return (
      <StatusBannerShell
        tone="warn"
        title={
          plainBanner
            ? 'Using Mushi platform keys'
            : `Using platform keys — ${stats.platformKeyCalls24h} call${stats.platformKeyCalls24h === 1 ? '' : 's'} in 24h`
        }
        subtitle={`${fmtUsd(stats.spend24hUsd)} in 24h on platform keys — add your own Anthropic key in Settings to control billing.`}
        action={
          <Link to="/settings?tab=byok">
            <Btn size="sm" variant="ghost">{actions.byok ?? 'Add BYOK'}</Btn>
          </Link>
        }
      />
    )
  }

  if (stats.ledgerCount > 0 && stats.invocationCount === 0) {
    return (
      <StatusBannerShell
        tone="info"
        title={plainBanner ? 'Legacy cost rows only' : `Legacy ledger only — ${stats.ledgerCount} llm_cost_usd rows`}
        subtitle="New telemetry writes to llm_invocations. Legacy rows are merged into totals until fully migrated."
      />
    )
  }

  return (
    <StatusBannerShell
      tone="ok"
      title={plainBanner ? 'AI spend tracking is active' : `Telemetry active for ${projectLabel}`}
      subtitle={
        <>
          {fmtUsd(stats.spend24hUsd)} in 24h · {stats.calls24h} calls
          {stats.lastCallAt ? (
            <> · last call <RelativeTime value={stats.lastCallAt} /></>
          ) : null}
          {stats.byokCalls24h > 0 ? ` · ${stats.byokCalls24h} BYOK` : ''}
        </>
      }
      action={
        onTab ? (
          <Btn size="sm" variant="ghost" onClick={() => onTab('breakdown')}>
            {actions.breakdown ?? 'View breakdown'}
          </Btn>
        ) : null
      }
    />
  )
}
