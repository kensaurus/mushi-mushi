/**
 * FILE: apps/admin/src/lib/useSentryConnection.test.ts
 * PURPOSE: Settings and Integrations must read the same Sentry verdict from
 *          the same inputs — Settings said "Not checked yet" while the
 *          Integrations card said connected (report e469ff36).
 */

import { describe, expect, it } from 'vitest'
import { sentryConnection } from './integrationConnection'
import {
  sentryConfiguredFromPlatform,
  sentryConnectionFromPageData,
  sentryQuerySettled,
  sentryRowStatus,
} from './useSentryConnection'
import { settingsBannerPriority } from '../components/settings/SettingsStatusBanner'
import { EMPTY_SETTINGS_STATS } from '../components/settings/types'
import type { HealthRow, PlatformResponse } from '../components/integrations/types'

const NOW = Date.parse('2026-10-04T01:00:00Z')
const RECENT = '2026-10-04T00:49:06Z'

const platform: PlatformResponse = {
  platform: { sentry: { sentry_org_slug: 'acme', sentry_auth_token_ref: 'ref_1' } },
  sourceByField: { sentry_org_slug: 'project', sentry_auth_token_ref: 'project' },
}

const probeRow: HealthRow = {
  id: 'h1',
  kind: 'sentry',
  status: 'ok',
  latency_ms: 40,
  message: 'HTTP 200',
  source: 'cron',
  checked_at: RECENT,
}

const accepted = { outcome: 'accepted', created_at: RECENT, error_message: null }

describe('sentryConfiguredFromPlatform', () => {
  it('counts an org-wide or env-backed credential as configured', () => {
    expect(
      sentryConfiguredFromPlatform({
        platform: { sentry: {} },
        sourceByField: { sentry_org_slug: 'env', sentry_auth_token_ref: 'org' },
      }),
    ).toBe(true)
  })

  it('is false with no credentials, and before the credentials are read', () => {
    expect(sentryConfiguredFromPlatform({ platform: {} })).toBe(false)
    expect(sentryConfiguredFromPlatform(null)).toBe(false)
  })
})

describe('sentryConnectionFromPageData', () => {
  it('matches the Integrations card verdict for identical inputs', () => {
    const shared = sentryConnectionFromPageData({
      platform,
      history: [probeRow],
      deliveries: [accepted],
      now: NOW,
    })
    const card = sentryConnection({
      configured: true,
      probe: probeRow,
      latestDelivery: accepted,
      deliveriesLoaded: true,
      deliveriesFailed: false,
      autoImport: { enabled: false, lastRunAt: null },
      now: NOW,
    })
    expect(shared).toEqual(card)
    expect(shared!.state).toBe('working')
  })

  it('ignores another integration\u2019s probe row', () => {
    const v = sentryConnectionFromPageData({
      platform,
      history: [{ ...probeRow, id: 'h0', kind: 'github' }],
      deliveries: [accepted],
      now: NOW,
    })
    expect(v!.state).toBe('checking')
  })

  it('is null until the credentials and the probe history are known', () => {
    expect(sentryConnectionFromPageData({ platform: null, history: [probeRow], deliveries: [] })).toBeNull()
    expect(sentryConnectionFromPageData({ platform, history: null, deliveries: [] })).toBeNull()
  })
})

describe('sentryRowStatus', () => {
  const savedHint = { state: 'checking' as const, detail: 'Saved. The Integrations page shows when Sentry sends its first error.' }

  it('a working Sentry never reads "Not checked yet" on Settings', () => {
    const shared = sentryConnectionFromPageData({ platform, history: [probeRow], deliveries: [accepted], now: NOW })
    const row = sentryRowStatus(shared, savedHint)
    expect(row.state).toBe('working')
    expect(row.detail).toMatch(/^Last event received/)
  })

  it('the Settings banner uses that same Working verdict, so it can reach all-clear without a DSN', () => {
    const shared = sentryConnectionFromPageData({ platform, history: [probeRow], deliveries: [accepted], now: NOW })
    const card = sentryConnection({
      configured: true,
      probe: probeRow,
      latestDelivery: accepted,
      deliveriesLoaded: true,
      autoImport: { enabled: false, lastRunAt: null },
      now: NOW,
    })
    expect(shared).toEqual(card)
    expect(
      settingsBannerPriority(
        { ...EMPTY_SETTINGS_STATS, projectId: 'p1', sdkConfigEnabled: true, byokAnthropicConfigured: true },
        { working: 1, attention: 0, replaced: 0, expiring: 0, checking: 0, off: 0, total: 1 },
        true,
        shared,
      ),
    ).toBe('healthy')
  })

  it('keeps the page\u2019s own hint while the verdict is unknown or there is nothing to check', () => {
    expect(sentryRowStatus(null, savedHint)).toEqual(savedHint)
    expect(sentryRowStatus({ state: 'not_connected' }, savedHint)).toEqual(savedHint)
  })

  it('borrows the saved hint when the shared verdict has no detail', () => {
    expect(sentryRowStatus({ state: 'attention' }, savedHint).detail).toBe(savedHint.detail)
  })
})

describe('sentryQuerySettled', () => {
  const pending = { data: null, error: null }
  const ready = { data: { ok: true }, error: null }

  it('waits for credentials, probe history, and deliveries once Sentry is configured', () => {
    expect(
      sentryQuerySettled({ enabled: true, platform: pending, history: pending, configured: false, deliveries: pending }),
    ).toBe(false)
    expect(
      sentryQuerySettled({ enabled: true, platform: ready, history: ready, configured: true, deliveries: pending }),
    ).toBe(false)
    expect(
      sentryQuerySettled({ enabled: true, platform: ready, history: ready, configured: true, deliveries: ready }),
    ).toBe(true)
  })

  it('does not wait for deliveries that were not requested, and a failed read is settled', () => {
    expect(
      sentryQuerySettled({ enabled: true, platform: ready, history: ready, configured: false, deliveries: pending }),
    ).toBe(true)
    expect(
      sentryQuerySettled({
        enabled: true,
        platform: ready,
        history: { data: null, error: 'nope' },
        configured: false,
        deliveries: pending,
      }),
    ).toBe(true)
    expect(sentryQuerySettled({ enabled: false, platform: pending, history: pending, configured: false, deliveries: pending })).toBe(
      true,
    )
  })
})
