/**
 * FILE: apps/docs/components/PricingEstimator.tsx
 * PURPOSE: Interactive pricing estimator for the Pricing page. Renders a
 *   diagnosis-count slider that updates the estimated monthly cost in real
 *   time, using the live tier pricing from the plan catalog.
 *
 * USAGE:
 *   <PricingEstimator />   (no props — defaults to Indie tier)
 *
 * TECHNICAL DETAILS:
 * - Pure client-side React with a range input (slider).
 * - Tier math in ../lib/pricing-estimator.ts (unit-tested).
 * - No API calls at render time — pricing constants are hardcoded so the
 *   estimator works while Nextra is doing static generation.
 */
'use client'

import { useState } from 'react'
import {
  ANNUAL_DISCOUNT_MONTHS,
  MAX_SLIDER,
  POPULAR_TIER_ID,
  TIERS,
  annualTotalUsd,
  displayBaseUsd,
  estimateCost,
  getNextTierId,
  getTierById,
} from '../lib/pricing-estimator'

export function PricingEstimator() {
  const [diagnoses, setDiagnoses] = useState(300)
  const [activeTierId, setActiveTierId] = useState('indie')
  const [annual, setAnnual] = useState(true)

  const activeTier = getTierById(activeTierId)
  const { total, overage, capped } = estimateCost(activeTier, diagnoses)
  const displayBase = displayBaseUsd(activeTier, annual)
  const nextTierId = capped ? getNextTierId(activeTierId) : null
  const nextTier = nextTierId ? getTierById(nextTierId) : null

  const inputId = 'pricing-estimator-slider'

  return (
    <div
      style={{
        border: '1px solid var(--nextra-colors-primary, #4f46e5)',
        borderRadius: 12,
        padding: '24px',
        margin: '24px 0',
        background: 'var(--nextra-bg, #fafafa)',
        maxWidth: 560,
      }}
    >
      <p style={{ margin: '0 0 16px', fontWeight: 600, fontSize: 16 }}>
        Interactive pricing estimator
      </p>

      {/* Billing cycle toggle */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          marginBottom: 16,
          fontSize: 13,
        }}
      >
        <button
          type="button"
          onClick={() => setAnnual(false)}
          style={{
            padding: '4px 12px',
            borderRadius: 999,
            border: `1.5px solid ${!annual ? '#4f46e5' : '#d1d5db'}`,
            background: !annual ? '#4f46e5' : 'transparent',
            color: !annual ? '#fff' : 'inherit',
            cursor: 'pointer',
            fontWeight: 500,
          }}
        >
          Monthly
        </button>
        <button
          type="button"
          onClick={() => setAnnual(true)}
          style={{
            padding: '4px 12px',
            borderRadius: 999,
            border: `1.5px solid ${annual ? '#4f46e5' : '#d1d5db'}`,
            background: annual ? '#4f46e5' : 'transparent',
            color: annual ? '#fff' : 'inherit',
            cursor: 'pointer',
            fontWeight: 500,
          }}
        >
          Annual
        </button>
        {annual && activeTier.baseUsd > 0 && (
          <span style={{ fontSize: 12, color: '#059669', fontWeight: 600 }}>
            Save {ANNUAL_DISCOUNT_MONTHS} months free
          </span>
        )}
      </div>

      {/* Tier picker */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {TIERS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setActiveTierId(t.id)}
            style={{
              padding: '6px 14px',
              borderRadius: 999,
              border: `1.5px solid ${t.id === activeTierId ? '#4f46e5' : '#d1d5db'}`,
              background: t.id === activeTierId ? '#4f46e5' : 'transparent',
              color: t.id === activeTierId ? '#fff' : 'inherit',
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: 500,
              position: 'relative',
            }}
          >
            {t.name}
            {t.id === POPULAR_TIER_ID && (
              <span
                style={{
                  marginLeft: 6,
                  fontSize: 11,
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  opacity: t.id === activeTierId ? 0.9 : 0.7,
                }}
              >
                Popular
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Slider */}
      <label htmlFor={inputId} style={{ fontSize: 14, display: 'block', marginBottom: 8 }}>
        Diagnoses / month:{' '}
        <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{diagnoses.toLocaleString()}</strong>
      </label>
      <input
        id={inputId}
        type="range"
        min={0}
        max={MAX_SLIDER}
        step={50}
        value={diagnoses}
        onChange={(e) => setDiagnoses(Number(e.target.value))}
        style={{ width: '100%', accentColor: '#4f46e5', marginBottom: 20 }}
      />

      {/* Cost breakdown */}
      <div
        style={{
          background: '#f0f0ff',
          borderRadius: 8,
          padding: '16px',
          fontSize: 14,
          lineHeight: 1.6,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
          <span>
            Base ({activeTier.name})
            {annual && activeTier.baseUsd > 0 ? ' · annual' : ''}
          </span>
          <strong>${displayBase.toFixed(2)}</strong>
        </div>
        {annual && activeTier.baseUsd > 0 && (
          <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>
            Billed ${annualTotalUsd(activeTier).toFixed(0)}/yr (${displayBase.toFixed(2)}/mo equivalent)
          </div>
        )}
        {overage > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, color: '#6b7280' }}>
            <span>
              Overage ({Math.max(0, diagnoses - activeTier.included).toLocaleString()} × $
              {activeTier.overageUsd})
              {capped ? ' — capped ✓' : ''}
            </span>
            <span>+${overage.toFixed(2)}</span>
          </div>
        )}
        {capped && activeTier.capUsd !== null && (
          <div style={{ fontSize: 12, color: '#059669', marginBottom: 6 }}>
            ✓ Spend cap (${activeTier.capUsd}/mo) prevents further charges — diagnoses pause gracefully.
          </div>
        )}
        {capped && activeTier.overageUsd === null && (
          <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 6 }}>
            Hard stop — diagnoses pause at {activeTier.included.toLocaleString()} / mo. No overage, no charge, no bill shock.
          </div>
        )}
        {capped && nextTier && (
          <button
            type="button"
            onClick={() => setActiveTierId(nextTier.id)}
            style={{
              marginBottom: 8,
              padding: '8px 14px',
              borderRadius: 6,
              border: 'none',
              background: '#4f46e5',
              color: '#fff',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
              width: '100%',
            }}
          >
            See {nextTier.name} pricing — more headroom
          </button>
        )}
        <hr style={{ border: 'none', borderTop: '1px solid #c7d2fe', margin: '8px 0' }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 18 }}>
          <span>Estimated total</span>
          <span>${total.toFixed(2)} / mo</span>
        </div>
        {diagnoses <= activeTier.included && (
          <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>
            Within your included {activeTier.included.toLocaleString()} diagnoses — no overage.
          </div>
        )}
      </div>

      <p style={{ margin: '12px 0 0', fontSize: 12, color: '#9ca3af' }}>
        Estimates use list pricing. Overage is metered monthly; annual saves {ANNUAL_DISCOUNT_MONTHS} months on base fees.{' '}
        <a href="/self-hosting" style={{ color: '#4f46e5' }}>
          Self-host for free
        </a>{' '}
        using your own LLM key.
      </p>
    </div>
  )
}

export { estimateCost, TIERS, MAX_SLIDER } from '../lib/pricing-estimator'
