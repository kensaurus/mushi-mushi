/**
 * FILE: packages/cli/src/commands/billing.ts
 * PURPOSE: `mushi usage` and `mushi billing` command group — diagnoses quota,
 *          spend cap management, and billing page deeplink.
 *
 * COMMANDS:
 *   mushi usage              Show diagnoses used / limit / cap for this billing period
 *   mushi billing            Show full billing summary
 *   mushi billing cap <usd>  Set a monthly spend cap (0 to clear)
 *
 * DEPENDENCIES:
 *   - ./cli-shared.ts  — apiCall, die, requireConfig, fmtDate, pad
 *   - commander        — Command
 */
import type { Command } from 'commander'
import { apiCall, die, requireConfig } from '../cli-shared.js'

interface UsageStats {
  planId: string
  diagnosesUsed: number
  diagnosesLimit: number | null
  diagnosesUsagePct: number | null
  overDiagnosisQuota: boolean
  approachingDiagnosisQuota: boolean
  monthlySpendCapUsd: number | null
  periodEnd: string | null
}

interface BillingStats {
  planId: string
  subscriptionStatus: string | null
  cancelAtPeriodEnd: boolean
  periodEnd: string | null
  diagnosesUsed: number
  diagnosesLimit: number | null
  diagnosesUsagePct: number | null
  overDiagnosisQuota: boolean
  approachingDiagnosisQuota: boolean
  monthlySpendCapUsd: number | null
  overageRateDiagnoses: number | null
}

export function registerBillingCommands(program: Command): void {
  // ─── mushi usage ──────────────────────────────────────────────────────────
  program
    .command('usage')
    .description('Show diagnoses used / limit / cap for the current billing period')
    .option('--json', 'Machine-readable JSON output')
    .addHelpText('after', `
Examples:
  mushi usage
  mushi usage --json`)
    .action(async (opts: { json?: boolean }) => {
      const config = requireConfig()
      const result = await apiCall<UsageStats>('/v1/admin/billing/stats', config)
      if (!result.ok) die(result)
      const s = result.data
      if (opts.json) {
        console.log(JSON.stringify(s, null, 2))
        return
      }
      const limitStr = s.diagnosesLimit != null ? String(s.diagnosesLimit) : 'unlimited'
      const pctStr = s.diagnosesUsagePct != null ? `${Math.round(s.diagnosesUsagePct)}%` : '—'
      const capStr = s.monthlySpendCapUsd != null ? `$${s.monthlySpendCapUsd}/mo` : 'none'
      const badge = s.overDiagnosisQuota ? ' ⚠ OVER LIMIT' : s.approachingDiagnosisQuota ? ' ⚠ approaching limit' : ''

      console.log(`\nDiagnoses this period: ${s.diagnosesUsed} / ${limitStr} (${pctStr})${badge}`)
      console.log(`Plan: ${s.planId ?? '—'}`)
      console.log(`Spend cap: ${capStr}`)
      console.log(`Period ends: ${s.periodEnd ? s.periodEnd.slice(0, 10) : '?'}`)
      if (s.overDiagnosisQuota) {
        console.log('\n  Diagnoses paused — upgrade at https://kensaur.us/mushi-mushi/admin/billing')
      } else if (s.approachingDiagnosisQuota) {
        console.log('\n  You\'re at 80%+ of your included diagnoses. Consider upgrading.')
      }
    })

  // ─── mushi billing ────────────────────────────────────────────────────────
  const billing = program
    .command('billing')
    .description('Show billing summary and manage spend cap')

  billing
    .command('status')
    .description('Show full billing summary (plan, usage, cap)')
    .option('--json', 'Machine-readable JSON output')
    .addHelpText('after', `
Examples:
  mushi billing status
  mushi billing status --json`)
    .action(async (opts: { json?: boolean }) => {
      const config = requireConfig()
      const result = await apiCall<BillingStats>('/v1/admin/billing', config)
      if (!result.ok) die(result)
      const s = result.data
      if (opts.json) {
        console.log(JSON.stringify(s, null, 2))
        return
      }
      const limitStr = s.diagnosesLimit != null ? String(s.diagnosesLimit) : 'unlimited'
      const pctStr = s.diagnosesUsagePct != null ? `${Math.round(s.diagnosesUsagePct)}%` : '—'
      const capStr = s.monthlySpendCapUsd != null ? `$${s.monthlySpendCapUsd}/mo` : 'none'
      const overageStr = s.overageRateDiagnoses != null ? `$${s.overageRateDiagnoses}/diagnosis` : 'N/A'

      console.log(`\nPlan:        ${s.planId ?? '—'}`)
      console.log(`Status:      ${s.subscriptionStatus ?? 'free'}${s.cancelAtPeriodEnd ? ' (cancels at period end)' : ''}`)
      console.log(`Diagnoses:   ${s.diagnosesUsed} / ${limitStr} (${pctStr})`)
      console.log(`Overage:     ${overageStr}`)
      console.log(`Spend cap:   ${capStr}`)
      console.log(`Renews:      ${s.periodEnd ? s.periodEnd.slice(0, 10) : '?'}`)
    })

  billing
    .command('cap [usd]')
    .description('Set or clear the monthly spend cap (pass 0 to clear, omit to show current cap)')
    .addHelpText('after', `
Examples:
  mushi billing cap           # show current cap
  mushi billing cap 100       # set $100/mo hard cap
  mushi billing cap 0         # clear cap`)
    .action(async (usdArg?: string) => {
      const config = requireConfig()
      if (usdArg === undefined) {
        // Show current cap.
        const result = await apiCall<UsageStats>('/v1/admin/billing/stats', config)
        if (!result.ok) die(result)
        const cap = result.data.monthlySpendCapUsd
        if (cap == null) {
          console.log('No spend cap set. Pass a dollar amount to set one, e.g.: mushi billing cap 100')
        } else {
          console.log(`Current spend cap: $${cap}/mo`)
        }
        return
      }
      const capUsd = parseFloat(usdArg)
      if (isNaN(capUsd) || capUsd < 0) {
        console.error('Error: spend cap must be a non-negative number (or 0 to clear).')
        process.exit(2)
      }
      const result = await apiCall<{ ok: boolean; spend_cap_usd: number | null }>('/v1/admin/billing/spend-cap', config, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_id: config.projectId, spend_cap_usd: capUsd === 0 ? null : capUsd }),
      })
      if (!result.ok) die(result)
      const cap = result.data.spend_cap_usd
      if (cap == null) {
        console.log('✓ Spend cap cleared — no hard monthly limit.')
      } else {
        console.log(`✓ Spend cap set to $${cap}/mo. Diagnoses will pause gracefully once reached.`)
      }
    })
}
