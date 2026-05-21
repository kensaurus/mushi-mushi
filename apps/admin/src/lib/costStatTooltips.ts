/**
 * FILE: apps/admin/src/lib/costStatTooltips.ts
 * PURPOSE: Human-readable StatCard tooltips for the LLM Cost "At a glance" strip.
 */

import type { MetricTooltipData } from '../components/ui'
import type { CostStats } from '../components/cost/types'

function fmtUsd(n: number): string {
  if (n >= 1) return `$${n.toFixed(2)}`
  if (n >= 0.01) return `$${n.toFixed(4)}`
  return `$${n.toFixed(6)}`
}

export function totalLoggedTooltip(stats: CostStats): MetricTooltipData {
  const takeaway =
    stats.totalCalls === 0
      ? `Your lifetime AI bill is ${fmtUsd(stats.totalSpendUsd)} across ${stats.invocationCount.toLocaleString()} invocation${stats.invocationCount === 1 ? '' : 's'}. Zero usually means no classify, fix, judge, or inventory agents have logged a call yet.`
      : `Your lifetime AI bill is ${fmtUsd(stats.totalSpendUsd)} across ${stats.invocationCount.toLocaleString()} invocation${stats.invocationCount === 1 ? '' : 's'}. Open Breakdown to see which operation or model drove most of this spend.`

  return {
    sections: [
      {
        label: 'Shows',
        kind: 'shows',
        body: 'All-time estimated LLM spend for the active project, in USD.',
      },
      {
        label: 'Counted from',
        kind: 'counted',
        body: 'Sums cost_usd on every llm_invocations row (one row per edge-function LLM call). When cost_usd is missing, Mushi estimates from input/output tokens and the model price table. Legacy llm_cost_usd rows are merged into the same total.',
      },
      {
        label: 'Takeaway',
        kind: 'takeaway',
        body: takeaway,
      },
    ],
    ...(stats.ledgerCount > 0
      ? {
          callout: {
            tone: 'info' as const,
            text: `${stats.ledgerCount.toLocaleString()} legacy llm_cost_usd rows are included so historical spend is not lost during migration.`,
          },
        }
      : {}),
  }
}

export function totalLoggedDetail(stats: CostStats): string {
  const legacy = stats.ledgerCount > 0 ? ` + ${stats.ledgerCount.toLocaleString()} legacy` : ''
  return `${stats.invocationCount.toLocaleString()} invocations${legacy}`
}

export function spend24hTooltip(stats: CostStats): MetricTooltipData {
  const takeaway =
    stats.calls24h === 0
      ? 'Your near-term burn rate is zero — normal on a quiet project. Agents only log cost when they actually call a model.'
      : `Your near-term burn rate: ${stats.calls24h.toLocaleString()} call${stats.calls24h === 1 ? '' : 's'} averaged ${fmtUsd(stats.avgCostPerCall24h)} each. Compare to This month and the daily chart to tell a one-off spike from steady usage.`

  return {
    sections: [
      {
        label: 'Shows',
        body: 'Estimated LLM spend in the rolling last 24 hours (UTC), plus how many calls ran in that window.',
      },
      {
        label: 'Counted from',
        body: 'Every llm_invocations row whose created_at falls within the last 24 hours contributes its cost_usd (or token-based estimate). Legacy ledger rows in the same window are included.',
      },
      {
        label: 'Takeaway',
        body: takeaway,
      },
    ],
    ...(stats.spendSpike24h
      ? {
          callout: {
            tone: 'warn' as const,
            text: `Spend spike: last 24h (${fmtUsd(stats.spend24hUsd)}) is at least 3× the prior 24h (${fmtUsd(stats.prior24hSpendUsd)}) and above $0.05. Check Raw log for a runaway cron or retry loop.`,
          },
        }
      : {}),
  }
}

export function spend24hDetail(stats: CostStats): string {
  return `${stats.calls24h.toLocaleString()} calls · avg ${fmtUsd(stats.avgCostPerCall24h)}/call`
}

export function spendMonthTooltip(stats: CostStats): MetricTooltipData {
  return {
    sections: [
      {
        label: 'Shows',
        body: 'LLM spend since the first day of the current UTC calendar month.',
      },
      {
        label: 'Counted from',
        body: 'Sums invocation and legacy ledger costs where the timestamp is on or after month start (UTC midnight on the 1st). The 7d and 30d figures under the card use rolling windows, not calendar boundaries.',
      },
      {
        label: 'Takeaway',
        body: `Month-to-date: ${fmtUsd(stats.spendMonthUsd)}. Rolling 7d is ${fmtUsd(stats.spend7dUsd)}; rolling 30d is ${fmtUsd(stats.spend30dUsd)}. Pair with Billing → LLM COGS for plan-level usage, or Breakdown to find the agent step driving the month.`,
      },
    ],
  }
}

export function spendMonthDetail(stats: CostStats): string {
  return `7d: ${fmtUsd(stats.spend7dUsd)} · 30d: ${fmtUsd(stats.spend30dUsd)}`
}

export function topDriverTooltip(stats: CostStats): MetricTooltipData {
  if (!stats.topOperation) {
    return {
      sections: [
        {
          label: 'Shows',
          body: 'The edge-function step that consumed the most LLM spend in the last 30 days.',
        },
        {
          label: 'Counted from',
          body: 'Groups rows by operation — function_name, or function_name:stage when a pipeline stage is logged (e.g. classify-report:triage). The label with the highest summed cost_usd wins.',
        },
        {
          label: 'Takeaway',
          body: 'Nothing logged yet. Run classify, fix-worker, judge-batch, or another agent once — this chip will name the priciest step so you know where to tune prompts or add caching.',
        },
      ],
    }
  }

  const fn = stats.topOperation.split(':')[0]
  const modelLine = stats.topModel
    ? `Top model in window: ${stats.topModel} (${fmtUsd(stats.topModelUsd)}).`
    : 'No model breakdown yet for this window.'

  return {
    sections: [
      {
        label: 'Shows',
        body: `The single costliest operation in the last 30 days — ${stats.topOperation} at ${fmtUsd(stats.topOperationUsd)}.`,
      },
      {
        label: 'Counted from',
        body: 'Each llm_invocations row is tagged with function_name and optional stage. Costs roll up per operation string; the card shows the function name before the colon.',
      },
      {
        label: 'Takeaway',
        body: `If spend feels high, start with ${fn} — your biggest lever. ${modelLine} Open Breakdown for the full ranked list.`,
      },
    ],
  }
}

export function topDriverDetail(stats: CostStats): string {
  if (!stats.topOperation) return 'Run classify or fix to populate'
  return `${fmtUsd(stats.topOperationUsd)} · ${stats.topModel ?? 'no model'}`
}

export function operationsTooltip(stats: CostStats): MetricTooltipData {
  const takeaway =
    stats.operationsCount === 0
      ? 'Zero until the first agent call — each edge function that hits an LLM adds one operation.'
      : `${stats.operationsCount} different step${stats.operationsCount === 1 ? '' : 's'} ran in 30 days.${stats.topOperation ? ` Top spender: ${stats.topOperation}.` : ''} A sudden jump often means a new cron or agent was enabled.`

  return {
    sections: [
      {
        label: 'Shows',
        body: 'How many distinct AI pipeline steps logged spend in the last 30 days.',
      },
      {
        label: 'Counted from',
        body: 'Unique operation strings from llm_invocations and legacy ledger rows in the 30-day window — function_name or function_name:stage (e.g. fix-worker:draft-pr).',
      },
      {
        label: 'Takeaway',
        body: takeaway,
      },
    ],
  }
}

export function operationsDetail(): string {
  return 'Distinct function:stage pairs · last 30 days'
}

export function modelsTooltip(stats: CostStats): MetricTooltipData {
  const top = stats.topModel
    ? `${stats.topModel} leads model spend at ${fmtUsd(stats.topModelUsd)} in this window.`
    : 'Model names appear after the first successful LLM response is logged.'

  const takeaway =
    stats.modelsCount > 3
      ? `${stats.modelsCount} model${stats.modelsCount === 1 ? '' : 's'} in use. ${top} Many models usually means different agents pick different defaults — check Breakdown if costs cluster on an expensive tier.`
      : `${stats.modelsCount} model${stats.modelsCount === 1 ? '' : 's'} in use. ${top} Most projects start with one Haiku/Sonnet pair; compare models in Breakdown before changing agent defaults.`

  return {
    sections: [
      {
        label: 'Shows',
        body: 'How many different LLM model IDs were billed in the last 30 days.',
      },
      {
        label: 'Counted from',
        body: 'Unique used_model values on llm_invocations rows (and model on legacy ledger rows) within the rolling 30-day window. Each provider model string counts once regardless of call volume.',
      },
      {
        label: 'Takeaway',
        body: takeaway,
      },
    ],
  }
}

export function modelsDetail(stats: CostStats): string {
  return stats.topModel ? `Top: ${stats.topModel}` : 'Models appear after first call'
}

export function keySourceTooltip(stats: CostStats): MetricTooltipData {
  const configured = stats.byokAnthropicConfigured
  const platform = stats.platformKeyCalls24h
  const byok = stats.byokCalls24h

  const takeaway = configured
    ? `Anthropic BYOK is configured. Last 24h: ${byok.toLocaleString()} BYOK call${byok === 1 ? '' : 's'}, ${platform.toLocaleString()} platform call${platform === 1 ? '' : 's'}.`
    : `No Anthropic BYOK key on file. ${platform.toLocaleString()} recent call${platform === 1 ? '' : 's'} used Mushi platform keys (${fmtUsd(stats.spend24hUsd)} in 24h). Add your key in Settings → LLM keys to control billing.`

  let callout: MetricTooltipData['callout']
  if (platform > 0 && !configured) {
    callout = {
      tone: 'warn',
      text: 'Platform-key spend hits Mushi metering, not your Anthropic invoice directly.',
    }
  } else if (byok > 0) {
    callout = {
      tone: 'ok',
      text: 'Recent calls are routing through your own key where agents support BYOK.',
    }
  }

  return {
    sections: [
      {
        label: 'Shows',
        body: 'Which API keys billed your LLM calls in the last 24 hours — your own (BYOK) or Mushi platform keys.',
      },
      {
        label: 'Counted from',
        body: 'Each llm_invocations row stores key_source. Rows in the last 24h with key_source=byok count toward BYOK; all others count as platform. Legacy ledger rows do not carry key_source and are excluded.',
      },
      {
        label: 'Takeaway',
        body: takeaway,
      },
    ],
    ...(callout ? { callout } : {}),
  }
}

export function keySourceDetail(stats: CostStats): string {
  if (stats.byokAnthropicConfigured) return 'Anthropic BYOK configured'
  return 'Add BYOK in Settings → LLM keys'
}
