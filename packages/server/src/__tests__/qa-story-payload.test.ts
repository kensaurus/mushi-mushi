/**
 * QA story create / update payloads (`api/routes/qa-coverage.ts`).
 *
 * Regression: POST …/qa-stories accepted `target_url` but never wrote it, and
 * PATCH could not set it, so every console-created story ran with no target
 * and ended `no_target_url`. Enabling a story from the console must also
 * approve it, because the runner only checks `enabled`.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('../../supabase/functions/_shared/db.ts', () => ({
  getServiceClient: () => {
    throw new Error('real getServiceClient must not be used in tests')
  },
}))
vi.mock('../../supabase/functions/_shared/auth.ts', () => ({
  jwtAuth: async (_c: unknown, next: () => Promise<void>) => next(),
  apiKeyAuth: async (_c: unknown, next: () => Promise<void>) => next(),
  requireApiKeyScope: () => async (_c: unknown, next: () => Promise<void>) => next(),
}))

type Mod = typeof import('../../supabase/functions/api/routes/qa-coverage.ts')
let mod: Mod

beforeAll(async () => {
  ;(globalThis as { Deno?: unknown }).Deno = { env: { get: (k: string) => process.env[k] } }
  mod = await import('../../supabase/functions/api/routes/qa-coverage.ts')
})

describe('buildQaStoryInsert', () => {
  it('writes the target URL the user typed', () => {
    const row = mod.buildQaStoryInsert('p1', {
      name: 't',
      prompt: 'Pricing shows 4 tiers',
      target_url: 'https://example.com/pricing',
      browser_provider: 'firecrawl_actions',
    })
    expect(row.target_url).toBe('https://example.com/pricing')
    expect(row.project_id).toBe('p1')
    expect(row.enabled).toBe(true)
  })

  it('stores null when no target is given (local stories)', () => {
    expect(mod.buildQaStoryInsert('p1', { name: 'local' }).target_url).toBeNull()
  })
})

describe('qaStoryPatchSchema + buildQaStoryPatch', () => {
  it('lets PATCH set and clear target_url', () => {
    const set = mod.qaStoryPatchSchema.parse({ target_url: 'https://example.com' })
    expect(mod.buildQaStoryPatch(set)).toEqual({ target_url: 'https://example.com' })
    const cleared = mod.qaStoryPatchSchema.parse({ target_url: null })
    expect(mod.buildQaStoryPatch(cleared)).toEqual({ target_url: null })
  })

  it('rejects a target that is not a URL', () => {
    expect(mod.qaStoryPatchSchema.safeParse({ target_url: 'not a url' }).success).toBe(false)
  })

  it('rejects a bad cron instead of storing it', () => {
    expect(mod.qaStoryPatchSchema.safeParse({ schedule_cron: 'hourly' }).success).toBe(false)
  })

  it('approves a story when it is turned on', () => {
    const patch = mod.buildQaStoryPatch(mod.qaStoryPatchSchema.parse({ enabled: true }))
    expect(patch).toEqual({ enabled: true, approval_status: 'approved' })
  })

  it('leaves approval alone when a story is turned off', () => {
    const patch = mod.buildQaStoryPatch(mod.qaStoryPatchSchema.parse({ enabled: false }))
    expect(patch).toEqual({ enabled: false })
  })

  it('ignores unknown fields', () => {
    const patch = mod.buildQaStoryPatch(mod.qaStoryPatchSchema.parse({ project_id: 'other', name: 'n' }))
    expect(patch).toEqual({ name: 'n' })
  })
})
