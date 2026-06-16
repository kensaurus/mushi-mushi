/**
 * FILE: packages/server/src/__tests__/tester-redeem-validation.test.ts
 * PURPOSE: Behavioral tests for POST /v1/tester/wallet/redeem request gates.
 *
 * The canonical implementation lives in
 * `_shared/tester-marketplace-helpers.ts` (Deno). Vitest cannot import Deno
 * modules directly, so this file mirrors the pure `validateRedeemRequestBody`
 * contract — keep in sync when changing redemption validation.
 */

import { describe, expect, it } from 'vitest'

type RedemptionCatalogEntry = {
  kind: 'mushi_pro_credit' | 'gift_card'
  points_spent: number
  face_value_usd?: number
  sku?: string
}

const REDEMPTION_CATALOG: Record<string, RedemptionCatalogEntry> = {
  'pro-1000': { kind: 'mushi_pro_credit', points_spent: 1000 },
  'gc-amazon-10': { kind: 'gift_card', points_spent: 1000, face_value_usd: 10, sku: 'amazon_10' },
}

function resolveCatalogItem(id: string): RedemptionCatalogEntry | null {
  return REDEMPTION_CATALOG[id] ?? null
}

type RedeemRequestBody = {
  catalogItemId?: string
  clientEventId?: string
  kind?: string
  points_spent?: number
  face_value_usd?: number
  sku?: string
}

type RedeemRequestValidation =
  | { ok: true; catalogItemId: string; clientEventId: string; entry: RedemptionCatalogEntry }
  | { ok: false; code: string; message: string; status: number }

function validateRedeemRequestBody(body: RedeemRequestBody): RedeemRequestValidation {
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

describe('validateRedeemRequestBody', () => {
  const validUuid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'

  it('accepts a valid catalogItemId + clientEventId', () => {
    const res = validateRedeemRequestBody({
      catalogItemId: 'gc-amazon-10',
      clientEventId: validUuid,
    })
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.entry.points_spent).toBe(1000)
      expect(res.entry.face_value_usd).toBe(10)
    }
  })

  it('rejects spoofed points_spent even when catalog id is valid', () => {
    const res = validateRedeemRequestBody({
      catalogItemId: 'gc-amazon-10',
      clientEventId: validUuid,
      points_spent: 1,
    })
    expect(res).toEqual({
      ok: false,
      code: 'invalid_request',
      message: 'Use catalogItemId only — point and dollar values are server-defined.',
      status: 400,
    })
  })

  it('rejects spoofed face_value_usd', () => {
    const res = validateRedeemRequestBody({
      catalogItemId: 'gc-amazon-10',
      clientEventId: validUuid,
      face_value_usd: 999,
    })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.code).toBe('invalid_request')
  })

  it('rejects spoofed kind and sku', () => {
    expect(validateRedeemRequestBody({ catalogItemId: 'pro-1000', clientEventId: validUuid, kind: 'gift_card' }).ok).toBe(false)
    expect(validateRedeemRequestBody({ catalogItemId: 'pro-1000', clientEventId: validUuid, sku: 'evil' }).ok).toBe(false)
  })

  it('rejects unknown catalog ids', () => {
    const res = validateRedeemRequestBody({
      catalogItemId: 'RT-TEST-fake',
      clientEventId: validUuid,
    })
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.code).toBe('invalid_catalog_item')
      expect(res.status).toBe(400)
    }
  })

  it('rejects missing clientEventId', () => {
    const res = validateRedeemRequestBody({ catalogItemId: 'pro-1000' })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.code).toBe('missing_params')
  })

  it('rejects missing catalogItemId', () => {
    const res = validateRedeemRequestBody({ clientEventId: validUuid })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.code).toBe('missing_params')
  })

  it('uses server catalog economics — not client values', () => {
    const res = validateRedeemRequestBody({
      catalogItemId: 'pro-1000',
      clientEventId: validUuid,
    })
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.entry.points_spent).toBe(1000)
      expect(res.entry.kind).toBe('mushi_pro_credit')
    }
  })
})

describe('severityToBountyAction mirror', () => {
  function severityToBountyAction(severity: string | null | undefined, submissionType: string | null | undefined): string {
    if (submissionType === 'enhancement') return 'enhancement'
    const s = (severity ?? 'medium').toLowerCase()
    if (s === 'critical') return 'bug_critical'
    if (s === 'high') return 'bug_high'
    if (s === 'low') return 'bug_low'
    return 'bug_medium'
  }

  it('maps severity + type to bounty actions', () => {
    expect(severityToBountyAction('medium', 'bug')).toBe('bug_medium')
    expect(severityToBountyAction('critical', 'bug')).toBe('bug_critical')
    expect(severityToBountyAction(null, 'enhancement')).toBe('enhancement')
  })
})
