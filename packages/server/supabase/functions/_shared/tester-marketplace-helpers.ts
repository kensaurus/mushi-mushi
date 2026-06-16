/**
 * FILE: _shared/tester-marketplace-helpers.ts
 * PURPOSE: Shared auth, bounty lookup, and redemption catalog for Mushi Bounties.
 */

import type { getServiceClient } from './db.ts'
import { accessibleProjectIds } from './project-access.ts'
import { checkSanctions } from './sanctions.ts'

export const KYC_THRESHOLD_USD = 400
export const KYC_ANNUAL_CAP_USD = 599

export const DEFAULT_BOUNTY_POINTS: Record<string, number> = {
  bug_critical: 2500,
  bug_high: 1000,
  bug_medium: 500,
  bug_low: 100,
  enhancement: 50,
}

export const BOUNTY_ACTION_KEYS = Object.keys(DEFAULT_BOUNTY_POINTS)

export type RedemptionCatalogEntry = {
  kind: 'mushi_pro_credit' | 'gift_card' | 'app_slot' | 'api_quota'
  points_spent: number
  face_value_usd?: number
  sku?: string
  label: string
  description: string
  category: 'pro' | 'giftcard'
  icon: string
  premiumMultiplier?: number
}

/** Server-authoritative redemption catalog — client may only pass catalogItemId. */
export const REDEMPTION_CATALOG: Record<string, RedemptionCatalogEntry> = {
  'pro-1000': {
    kind: 'mushi_pro_credit',
    points_spent: 1000,
    label: 'Mushi Pro credit — $13',
    description: 'Apply 1,000 mushi-points toward your Mushi Pro subscription (1.3× premium).',
    category: 'pro',
    icon: '🚀',
    premiumMultiplier: 1.3,
  },
  'gc-amazon-10': {
    kind: 'gift_card',
    points_spent: 1000,
    face_value_usd: 10,
    sku: 'amazon_10',
    label: 'Amazon gift card — $10',
    description: '$10 Amazon.com gift card. Taxable at fair market value.',
    category: 'giftcard',
    icon: '🛍️',
  },
  'gc-starbucks-10': {
    kind: 'gift_card',
    points_spent: 1000,
    face_value_usd: 10,
    sku: 'starbucks_10',
    label: 'Starbucks gift card — $10',
    description: '$10 Starbucks eGift card.',
    category: 'giftcard',
    icon: '☕',
  },
  'gc-appstore-10': {
    kind: 'gift_card',
    points_spent: 1000,
    face_value_usd: 10,
    sku: 'appstore_10',
    label: 'App Store gift card — $10',
    description: '$10 Apple App Store & iTunes gift card.',
    category: 'giftcard',
    icon: '🍎',
  },
}

export function resolveCatalogItem(catalogItemId: string): RedemptionCatalogEntry | null {
  return REDEMPTION_CATALOG[catalogItemId] ?? null
}

export type RedeemRequestBody = {
  catalogItemId?: string
  clientEventId?: string
  kind?: string
  points_spent?: number
  face_value_usd?: number
  sku?: string
}

export type RedeemRequestValidation =
  | { ok: true; catalogItemId: string; clientEventId: string; entry: RedemptionCatalogEntry }
  | { ok: false; code: string; message: string; status: number }

/** Pure gate for POST /v1/tester/wallet/redeem — rejects client-supplied economics. */
export function validateRedeemRequestBody(body: RedeemRequestBody): RedeemRequestValidation {
  if (
    body.kind !== undefined ||
    body.points_spent !== undefined ||
    body.face_value_usd !== undefined ||
    body.sku !== undefined
  ) {
    return {
      ok: false,
      code: 'invalid_request',
      message: 'Use catalogItemId only — point and dollar values are server-defined.',
      status: 400,
    }
  }

  const catalogItemId = body.catalogItemId
  const clientEventId = body.clientEventId
  if (!catalogItemId || !clientEventId) {
    return {
      ok: false,
      code: 'missing_params',
      message: 'catalogItemId and clientEventId are required.',
      status: 400,
    }
  }

  const entry = resolveCatalogItem(catalogItemId)
  if (!entry) {
    return {
      ok: false,
      code: 'invalid_catalog_item',
      message: 'Unknown catalog item',
      status: 400,
    }
  }

  return { ok: true, catalogItemId, clientEventId, entry }
}

export function severityToBountyAction(
  severity: string | null | undefined,
  submissionType: string | null | undefined,
): string {
  if (submissionType === 'enhancement') return 'enhancement'
  const s = (severity ?? 'medium').toLowerCase()
  if (s === 'critical') return 'bug_critical'
  if (s === 'high') return 'bug_high'
  if (s === 'low') return 'bug_low'
  return 'bug_medium'
}

export async function lookupBountyPoints(
  supabase: ReturnType<typeof getServiceClient>,
  appId: string,
  action: string,
): Promise<{ points: number; dailyCap: number | null; lifetimeCap: number | null }> {
  const { data: row } = await supabase
    .from('published_app_bounties')
    .select('points_per_event, daily_cap, lifetime_cap_per_tester, enabled')
    .eq('app_id', appId)
    .eq('action', action)
    .maybeSingle()

  if (row && row.enabled === false) {
    return { points: 0, dailyCap: row.daily_cap, lifetimeCap: row.lifetime_cap_per_tester }
  }

  const points = row?.points_per_event ?? DEFAULT_BOUNTY_POINTS[action] ?? 50
  return {
    points,
    dailyCap: row?.daily_cap ?? null,
    lifetimeCap: row?.lifetime_cap_per_tester ?? null,
  }
}

export async function requireSubmissionProjectAccess(
  supabase: ReturnType<typeof getServiceClient>,
  userId: string,
  submissionId: string,
): Promise<
  | { ok: true; projectId: string; appId: string }
  | { ok: false; status: 403 | 404; error: string }
> {
  const { data: sub } = await supabase
    .from('tester_submissions')
    .select('id, app_id')
    .eq('id', submissionId)
    .maybeSingle()

  if (!sub) return { ok: false, status: 404, error: 'submission_not_found' }

  const { data: app } = await supabase
    .from('published_apps')
    .select('project_id')
    .eq('id', sub.app_id)
    .maybeSingle()

  if (!app?.project_id) return { ok: false, status: 404, error: 'app_not_found' }

  const allowed = await accessibleProjectIds(supabase, userId)
  if (!allowed.includes(app.project_id)) {
    return { ok: false, status: 403, error: 'forbidden' }
  }

  return { ok: true, projectId: app.project_id, appId: sub.app_id }
}

export type AwardPointsResult = {
  ok: boolean
  idempotentSkip?: boolean
  error?: string
  balanceAfter?: number
}

export async function awardPointsChecked(
  supabase: ReturnType<typeof getServiceClient>,
  params: {
    testerId: string
    deltaPoints: number
    reason: string
    idempotencyKey: string
    submissionId?: string
    appId?: string
  },
): Promise<AwardPointsResult> {
  const { data, error } = await supabase.rpc('award_tester_points', {
    p_tester_id: params.testerId,
    p_delta_points: params.deltaPoints,
    p_reason: params.reason,
    p_submission_id: params.submissionId ?? null,
    p_app_id: params.appId ?? null,
    p_idempotency_key: params.idempotencyKey,
  })

  if (error) {
    return { ok: false, error: error.message }
  }

  const result = data as {
    error?: string
    balance_after?: number
    idempotent_skip?: boolean
  } | null

  if (result?.error) {
    return { ok: false, error: result.error }
  }

  return {
    ok: true,
    idempotentSkip: result?.idempotent_skip === true,
    balanceAfter: result?.balance_after,
  }
}

export async function resolveBudgetProjectId(
  supabase: ReturnType<typeof getServiceClient>,
  testerId: string,
): Promise<string | null> {
  const { data: ledger } = await supabase
    .from('tester_credit_ledger')
    .select('app_id')
    .eq('tester_id', testerId)
    .not('app_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (ledger?.app_id) {
    const { data: app } = await supabase
      .from('published_apps')
      .select('project_id')
      .eq('id', ledger.app_id)
      .maybeSingle()
    if (app?.project_id) return app.project_id
  }

  const { data: sub } = await supabase
    .from('tester_app_subscriptions')
    .select('app_id')
    .eq('tester_id', testerId)
    .eq('status', 'active')
    .limit(1)
    .maybeSingle()

  if (!sub?.app_id) return null

  const { data: app } = await supabase
    .from('published_apps')
    .select('project_id')
    .eq('id', sub.app_id)
    .maybeSingle()

  return app?.project_id ?? null
}

export async function checkGiftCardKycAndCap(
  supabase: ReturnType<typeof getServiceClient>,
  testerId: string,
  faceValueUsd: number,
): Promise<{ ok: true } | { ok: false; code: string; message: string; status: number }> {
  const { data: ytdData } = await supabase
    .from('tester_redemptions')
    .select('face_value_usd')
    .eq('tester_id', testerId)
    .eq('kind', 'gift_card')
    .in('status', ['complete', 'processing', 'pending'])
    .gte('requested_at', `${new Date().getFullYear()}-01-01`)

  const ytd = (ytdData ?? []).reduce((acc, r) => acc + (r.face_value_usd ?? 0), 0)

  if (ytd + faceValueUsd > KYC_ANNUAL_CAP_USD) {
    return {
      ok: false,
      code: 'annual_cap_exceeded',
      message: `Gift card redemptions are capped at $${KYC_ANNUAL_CAP_USD} per calendar year.`,
      status: 402,
    }
  }

  if (ytd + faceValueUsd >= KYC_THRESHOLD_USD) {
    const { data: kyc } = await supabase
      .from('tester_kyc')
      .select('withholding_status')
      .eq('tester_id', testerId)
      .maybeSingle()

    if (!kyc || kyc.withholding_status !== 'cleared') {
      return {
        ok: false,
        code: 'kyc_required',
        message: 'Identity verification required before additional gift card redemptions.',
        status: 402,
      }
    }
  }

  return { ok: true }
}

export function checkPayoutSanctions(
  countryCode: string | null,
): { ok: true } | { ok: false; code: string; message: string } {
  const sanctions = checkSanctions(countryCode)
  if (sanctions.blocked) {
    return {
      ok: false,
      code: 'region_not_supported',
      message: sanctions.reason ?? 'Region not supported for payouts.',
    }
  }
  return { ok: true }
}

export async function checkDailyBountyCap(
  supabase: ReturnType<typeof getServiceClient>,
  testerId: string,
  appId: string,
  action: string,
  dailyCap: number | null,
): Promise<boolean> {
  if (!dailyCap || dailyCap <= 0) return true

  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString()
  const { count } = await supabase
    .from('tester_submissions')
    .select('id', { count: 'exact', head: true })
    .eq('tester_id', testerId)
    .eq('app_id', appId)
    .eq('status', 'accepted')
    .gte('reviewed_at', since)

  return (count ?? 0) < dailyCap
}

/** Wallet + catalog API shape for TesterWalletPage. */
export function buildWalletCatalogItems(
  kycStatus: string,
  etaHours: number | null,
): Array<{
  id: string
  name: string
  description: string
  pointsCost: number
  valueUsd: number
  category: 'pro' | 'giftcard'
  icon: string
  isAvailable: boolean
  unavailableReason?: string
  etaHours: number | null
  conversionPreview: string
}> {
  return Object.entries(REDEMPTION_CATALOG).map(([id, entry]) => {
    const isGift = entry.kind === 'gift_card'
    const valueUsd = isGift
      ? (entry.face_value_usd ?? 10)
      : Math.round(entry.points_spent * (entry.premiumMultiplier ?? 1) / 100 * 100) / 100 * 13 / 1000 * 1000
    const proValue = entry.kind === 'mushi_pro_credit' ? 13 : (entry.face_value_usd ?? 10)
    const multiplier = entry.premiumMultiplier ?? 1
    const preview = entry.kind === 'mushi_pro_credit'
      ? `${entry.points_spent.toLocaleString()} pts × ${multiplier}× = $13.00 Mushi Pro credit · arrives within 60s`
      : `${entry.points_spent.toLocaleString()} pts × 1.0× = $${entry.face_value_usd} ${entry.label.split('—')[0]?.trim() ?? 'gift card'} · email arrives within ${etaHours ?? 24}h`

    return {
      id,
      name: entry.label,
      description: entry.description,
      pointsCost: entry.points_spent,
      valueUsd: proValue,
      category: entry.category,
      icon: entry.icon,
      isAvailable: isGift ? kycStatus !== 'rejected' : true,
      unavailableReason: isGift && kycStatus === 'rejected' ? 'KYC rejected' : undefined,
      etaHours: isGift ? etaHours : null,
      conversionPreview: preview,
    }
  })
}
