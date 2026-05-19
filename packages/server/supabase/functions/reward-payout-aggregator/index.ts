// ============================================================
// Reward payout aggregator (cron, monthly on the 1st at 09:00 UTC).
//
// Processes all reward_payouts rows in status = 'pending':
//   1. Verifies the end_user has a completed KYC (reward_payout_accounts.kyc_status = 'complete').
//   2. Checks anti-fraud flags on the end_user.
//   3. Calls Stripe Transfers API to move funds to the Connect Express account.
//   4. Updates reward_payouts.status to 'paid' or 'failed'.
//
// Idempotent via reward_payouts.idempotency_key (Stripe-level + DB UNIQUE).
//
// Schedule (configured in Supabase dashboard cron):
//   0 9 1 * * → runs at 09:00 UTC on the 1st of every month.
//
// Gated by pricing_plans.feature_flags.rewards_monetary.
// ============================================================

import { getServiceClient } from '../_shared/db.ts'
import { log } from '../_shared/logger.ts'
import { withSentry } from '../_shared/sentry.ts'
import { requireServiceRoleAuth } from '../_shared/auth.ts'
import {
  stripeFromEnv,
  retrieveConnectAccount,
  createConnectTransfer,
} from '../_shared/stripe.ts'

declare const Deno: { serve: (handler: (req: Request) => Promise<Response>) => void }

const plog = log.child('reward-payout-aggregator')

// How many payouts to process per run (safety cap)
const BATCH_SIZE = 100

interface PendingPayout {
  id: string
  end_user_id: string
  organization_id: string
  amount_usd: number
  currency: string
  tier_slug: string | null
  idempotency_key: string | null
  reward_payout_accounts: {
    stripe_connect_account_id: string
    kyc_status: string
  } | null
  end_users: {
    anti_fraud_flags: string[]
  } | null
}

async function runAggregator(): Promise<{
  processed: number
  paid: number
  failed: number
  withheld: number
  skipped: number
}> {
  const db = getServiceClient()
  const cfg = stripeFromEnv()

  const stats = { processed: 0, paid: 0, failed: 0, withheld: 0, skipped: 0 }

  // Fetch pending payouts with their account + fraud info
  const { data: payouts, error } = await db
    .from('reward_payouts')
    .select(`
      id,
      end_user_id,
      organization_id,
      amount_usd,
      currency,
      tier_slug,
      idempotency_key,
      reward_payout_accounts (
        stripe_connect_account_id,
        kyc_status
      ),
      end_users (
        anti_fraud_flags
      )
    `)
    .eq('status', 'pending')
    .order('requested_at', { ascending: true })
    .limit(BATCH_SIZE) as { data: PendingPayout[] | null; error: unknown }

  if (error) {
    plog.error('fetch_pending_failed', { error: String(error) })
    return stats
  }

  for (const payout of payouts ?? []) {
    stats.processed++

    // Anti-fraud gate: withheld if flagged
    const fraudFlags = payout.end_users?.anti_fraud_flags ?? []
    if (fraudFlags.length > 0) {
      await db.from('reward_payouts').update({
        status: 'withheld',
        withheld_reason: `anti_fraud_flags: ${fraudFlags.join(', ')}`,
      }).eq('id', payout.id)
      stats.withheld++
      plog.warn('payout_withheld', { payoutId: payout.id, flags: fraudFlags })
      continue
    }

    // KYC gate: must be complete
    const account = payout.reward_payout_accounts
    if (!account || account.kyc_status !== 'complete') {
      stats.skipped++
      plog.info('payout_skipped_kyc', { payoutId: payout.id, kycStatus: account?.kyc_status ?? 'not_started' })
      continue
    }

    // Verify Stripe account is still payouts-enabled
    let stripeAccount
    try {
      stripeAccount = await retrieveConnectAccount(cfg, account.stripe_connect_account_id)
    } catch (err) {
      plog.warn('stripe_account_retrieve_failed', { payoutId: payout.id, error: String(err) })
      stats.skipped++
      continue
    }

    if (!stripeAccount.payouts_enabled) {
      stats.skipped++
      plog.info('payout_skipped_payouts_disabled', { payoutId: payout.id, accountId: account.stripe_connect_account_id })
      continue
    }

    // P3: check monthly budget cap before processing
    const { data: budgetCheck } = await db.rpc('check_payout_budget', {
      p_organization_id: payout.organization_id,
      p_amount_usd: payout.amount_usd,
    }) as { data: { would_exceed: boolean; pct_used: number | null } | null }

    if (budgetCheck?.would_exceed) {
      plog.warn('payout_budget_cap_exceeded', {
        payoutId: payout.id,
        amountUsd: payout.amount_usd,
        pctUsed: budgetCheck.pct_used,
      })
      // Withhold this run; will be retried next month after operator increases cap
      await db.from('reward_payouts').update({
        status: 'withheld',
        withheld_reason: 'monthly_budget_cap_exceeded',
      }).eq('id', payout.id)
      stats.withheld++
      continue
    }

    // Mark as processing to prevent concurrent picks
    await db.from('reward_payouts').update({
      status: 'processing',
      processing_started_at: new Date().toISOString(),
    }).eq('id', payout.id).eq('status', 'pending')

    // Build idempotency key (stable across retries)
    const idempotencyKey = payout.idempotency_key ?? `mushi-payout-${payout.id}`
    const amountCents = Math.round(payout.amount_usd * 100)

    try {
      const transfer = await createConnectTransfer(cfg, {
        amountCents,
        currency: payout.currency,
        destination: account.stripe_connect_account_id,
        idempotencyKey,
        metadata: {
          mushi_payout_id: payout.id,
          mushi_end_user_id: payout.end_user_id,
          mushi_org_id: payout.organization_id,
          tier_slug: payout.tier_slug ?? '',
        },
      })

      await db.from('reward_payouts').update({
        status: 'paid',
        stripe_transfer_id: transfer.id,
        paid_at: new Date().toISOString(),
        idempotency_key: idempotencyKey,
      }).eq('id', payout.id)

      stats.paid++
      plog.info('payout_paid', { payoutId: payout.id, transferId: transfer.id, amountCents })
    } catch (err) {
      const errMsg = String(err)
      await db.from('reward_payouts').update({
        status: 'failed',
        stripe_failure_code: errMsg.slice(0, 256),
        idempotency_key: idempotencyKey,
      }).eq('id', payout.id)

      stats.failed++
      plog.error('payout_failed', { payoutId: payout.id, error: errMsg })
    }
  }

  return stats
}

Deno.serve(withSentry('reward-payout-aggregator', async (req: Request) => {
  const authError = requireServiceRoleAuth(req)
  if (authError) return authError

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ ok: false, error: 'POST only' }), { status: 405 })
  }

  plog.info('run_start')
  const stats = await runAggregator()
  plog.info('run_complete', stats)

  return new Response(JSON.stringify({ ok: true, data: stats }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}))
