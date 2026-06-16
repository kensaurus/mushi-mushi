/**
 * FILE: mcp-tool-audit.test.ts
 * PURPOSE: Unit tests for MCP tool arg fingerprinting (shape-only, no values).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../supabase/functions/_shared/sentry.ts', () => ({
  reportMessage: vi.fn(),
}))

vi.mock('../../supabase/functions/_shared/db.ts', () => ({
  getServiceClient: vi.fn(() => ({
    from: vi.fn(() => ({
      insert: vi.fn().mockResolvedValue({ error: null }),
    })),
  })),
}))

describe('mcp-tool-audit', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubEnv('MUSHI_LOG_FORMAT', 'json')
    vi.stubEnv('MUSHI_LOG_LEVEL', 'silent')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('fingerprints arg shape without embedding values', async () => {
    const { fingerprintToolArgs } = await import('../../supabase/functions/_shared/mcp-tool-audit.ts')
    const a = await fingerprintToolArgs({ reportId: 'secret-uuid', limit: 10 })
    const b = await fingerprintToolArgs({ reportId: 'other-uuid', limit: 20 })
    expect(a).toBe(b)
    expect(a).toMatch(/^[a-f0-9]{16}$/)
  })

  it('returns null for empty args', async () => {
    const { fingerprintToolArgs } = await import('../../supabase/functions/_shared/mcp-tool-audit.ts')
    expect(await fingerprintToolArgs(undefined)).toBeNull()
    expect(await fingerprintToolArgs({})).toBeNull()
  })

  it('differs when arg keys differ', async () => {
    const { fingerprintToolArgs } = await import('../../supabase/functions/_shared/mcp-tool-audit.ts')
    const a = await fingerprintToolArgs({ reportId: 'x' })
    const b = await fingerprintToolArgs({ fixId: 'x' })
    expect(a).not.toBe(b)
  })
})
