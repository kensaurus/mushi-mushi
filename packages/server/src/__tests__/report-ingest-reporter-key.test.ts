/**
 * FILE: packages/server/src/__tests__/report-ingest-reporter-key.test.ts
 * PURPOSE: Report ingest must derive the stored reporter key from the raw token
 *          exactly once — the same key the reporter-thread routes derive from
 *          the SDK's signed digest (reporter-auth.test.ts).
 *
 * A second application (key of a key) or a missing one (raw digest stored)
 * both leave the reporter unable to see their own report thread, and the
 * second case is the credential-at-rest bug fixed on 2026-09-22.
 */
import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'

const { seen } = vi.hoisted(() => ({ seen: [] as string[] }))

// Anti-gaming is the first consumer of the key: capture it and stop ingest.
vi.mock('../../supabase/functions/_shared/anti-gaming.ts', () => ({
  checkAntiGaming: async (_db: unknown, _projectId: string, tokenHash: string) => {
    seen.push(tokenHash)
    throw new Error('stop-after-key')
  },
}))
vi.mock('../../supabase/functions/_shared/db.ts', () => ({ getServiceClient: () => ({}) }))
vi.mock('../../supabase/functions/_shared/logger.ts', () => {
  const logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => logger }
  return { log: logger }
})
vi.mock('../../supabase/functions/_shared/quota.ts', () => ({ checkIngestQuota: async () => ({ allowed: true }) }))
vi.mock('../../supabase/functions/_shared/storage.ts', () => ({ getStorageAdapter: async () => ({}) }))
vi.mock('../../supabase/functions/_shared/telemetry.ts', () => ({ logAntiGamingEvent: async () => {} }))
vi.mock('../../supabase/functions/_shared/reputation.ts', () => ({ awardPoints: async () => {}, awardPointsForEndUser: async () => {} }))
vi.mock('../../supabase/functions/_shared/end-user-resolver.ts', () => ({ resolveEndUser: async () => null }))
vi.mock('../../supabase/functions/_shared/end-user-identity.ts', () => ({ verifyEndUserToken: async () => null }))
vi.mock('../../supabase/functions/_shared/notifications.ts', () => ({ createNotification: async () => {}, buildNotificationMessage: () => '' }))
vi.mock('../../supabase/functions/_shared/plugins.ts', () => ({ dispatchPluginEventDetached: () => {} }))
vi.mock('../../supabase/functions/_shared/slack.ts', () => ({ sendBotMessage: async () => {}, sendSlackText: async () => {} }))
vi.mock('../../supabase/functions/_shared/sdk-observation.ts', () => ({ upsertProjectSdkObservationAsync: () => {} }))
vi.mock('../../supabase/functions/_shared/product-events.ts', () => ({ emitProductEvent: async () => true }))
vi.mock('../../supabase/functions/_shared/internal-headers.ts', () => ({ propagateRequestId: () => ({}) }))
vi.mock('../../supabase/functions/_shared/trace.ts', () => ({ childTraceparent: () => undefined }))
vi.mock('../../supabase/functions/api/shared.ts', () => ({ dbError: () => new Response() }))

const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex')

function report(reporterToken: string) {
  return {
    projectId: '00000000-0000-4000-8000-0000000000aa',
    category: 'bug',
    description: 'The submit button does nothing when clicked on the checkout page',
    environment: {
      userAgent: 'Mozilla/5.0 (unit) Chrome/120',
      platform: 'Win32',
      language: 'en-US',
      viewport: { width: 1440, height: 900 },
      url: 'https://example.com/checkout',
      referrer: 'https://example.com/cart',
      timestamp: new Date().toISOString(),
      timezone: 'Asia/Tokyo',
    },
    reporterToken,
    createdAt: new Date().toISOString(),
  }
}

describe('report ingest stores the reporter key, derived once', () => {
  it('rk1_ || sha256(sha256(raw token))', async () => {
    const { ingestReport } = await import('../../supabase/functions/api/helpers.ts')
    const token = 'mushi_4f5a2d7e-1c3b-4e8a-9f6d-2b7c8e1a0d33' // gitleaks:allow
    seen.length = 0
    await expect(ingestReport({} as never, '00000000-0000-4000-8000-0000000000aa', report(token))).rejects.toThrow(
      'stop-after-key',
    )
    expect(seen).toEqual([`rk1_${sha256(sha256(token))}`])
  })
})
