import { describe, expect, it } from 'vitest'
import { isInboxStatusBannerCritical } from '../components/inbox/InboxStatusBanner'
import { isComplianceStatusBannerCritical } from '../components/compliance/ComplianceStatusBanner'
import { isStorageStatusBannerCritical } from '../components/storage/StorageStatusBanner'
import { EMPTY_INBOX_STATS } from '../components/inbox/types'

describe('isInboxStatusBannerCritical', () => {
  it('returns false when inbox is nominal', () => {
    expect(
      isInboxStatusBannerCritical({
        ...EMPTY_INBOX_STATS,
        hasAnyProject: true,
        topPriority: 'clear',
      }),
    ).toBe(false)
  })

  it('returns true when open actions need attention', () => {
    expect(
      isInboxStatusBannerCritical({
        ...EMPTY_INBOX_STATS,
        hasAnyProject: true,
        topPriority: 'actions',
      }),
    ).toBe(true)
  })
})

describe('isComplianceStatusBannerCritical', () => {
  it('returns false when compliant and entitled', () => {
    expect(
      isComplianceStatusBannerCritical({
        projectId: 'p1',
        soc2Entitlement: true,
        controlsFail: 0,
        overdueDsars: 0,
        evidenceNeverGenerated: false,
        controlsWarn: 0,
        atRiskDsars: 0,
      } as Parameters<typeof isComplianceStatusBannerCritical>[0]),
    ).toBe(false)
  })
})

describe('isStorageStatusBannerCritical', () => {
  it('returns true when active bucket is failing', () => {
    expect(
      isStorageStatusBannerCritical({
        projectId: 'p1',
        activeProjectHealthStatus: 'failing',
        activeProjectConfigured: true,
        lastHealthCheckAt: '2026-01-01',
        failingCount: 1,
      } as Parameters<typeof isStorageStatusBannerCritical>[0]),
    ).toBe(true)
  })
})
