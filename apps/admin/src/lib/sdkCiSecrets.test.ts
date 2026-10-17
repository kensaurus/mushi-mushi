import { describe, it, expect } from 'vitest'
import {
  sdkCiStatusMeta,
  type SdkDiagnosticStatus,
} from './sdkCiSecrets'

describe('sdkCiStatusMeta', () => {
  const statuses: SdkDiagnosticStatus[] = [
    'healthy',
    'ci-secret-missing',
    'native-never-seen',
    'banner-disabled',
    'unknown',
  ]

  it.each(statuses)('returns a meta object for status %s', (status) => {
    const meta = sdkCiStatusMeta(status, true, 'glot-it', { nativeEverSeen: true, launcherMode: null })
    expect(meta.headline).toBeTruthy()
    expect(meta.chipLabel).toBeTruthy()
    expect(meta.subtitle).toBeTruthy()
    expect(meta.playbookSteps.length).toBeGreaterThan(0)
    expect(['ok', 'warn', 'error']).toContain(meta.severity)
  })

  it('healthy native headline when nativeEverSeen', () => {
    const meta = sdkCiStatusMeta('healthy', true, 'yen-yen', { nativeEverSeen: true, launcherMode: null })
    expect(meta.headline).toMatch(/checking in/i)
    expect(meta.chipLabel).toBe('Connected')
  })

  it('ci-secret-missing uses stack-aware env pair', () => {
    const meta = sdkCiStatusMeta('ci-secret-missing', false, 'yen-yen')
    expect(meta.subtitle).toContain('EXPO_PUBLIC_MUSHI_PROJECT_ID')
    expect(meta.headline).toMatch(/not connected/i)
  })

  it('shows "Sync CI secrets automatically" CTA when GitHub token present + missing', () => {
    const meta = sdkCiStatusMeta('ci-secret-missing', true)
    expect(meta.cta).toContain('automatically')
  })

  it('shows copy fallback CTA when no GitHub token', () => {
    const meta = sdkCiStatusMeta('ci-secret-missing', false)
    expect(meta.cta.toLowerCase()).toContain('copy')
  })

  it('shows copy fallback CTA for healthy status when no GitHub token', () => {
    // Regression: the CTA previously stayed "Re-sync secrets" even without a
    // token, which paired with an enabled button that called sync() and was
    // guaranteed to fail. Healthy status must fall back like every other
    // status once there's no token to act on.
    const meta = sdkCiStatusMeta('healthy', false)
    expect(meta.cta.toLowerCase()).toContain('copy')
  })
})
