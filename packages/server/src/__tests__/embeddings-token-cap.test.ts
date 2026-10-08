/**
 * One embedding input over 8,192 tokens failed its whole batch of 96, every
 * sweep: the-wanting-mind's codebase index stalled at 581 of 743 files. The
 * old cap was 8,000 characters, which Thai, Japanese, emoji or base64 can
 * exceed in tokens. capForEmbedding costs characters conservatively.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('../../supabase/functions/_shared/db.ts', () => ({
  getServiceClient: () => ({}),
}))
vi.mock('../../supabase/functions/_shared/logger.ts', () => {
  const noop = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => noop }
  return { log: noop }
})
vi.mock('../../supabase/functions/_shared/observability.ts', () => ({
  createTrace: () => ({ id: 'test-trace', span: () => ({ end: () => {} }), end: async () => {} }),
}))
vi.mock('../../supabase/functions/_shared/byok.ts', () => ({
  resolveLlmKey: async () => null,
}))

import { capForEmbedding } from '../../supabase/functions/_shared/embeddings.ts'

describe('capForEmbedding', () => {
  it('keeps short text whole', () => {
    expect(capForEmbedding('function a() {}')).toBe('function a() {}')
  })

  it('keeps the old 8,000-character ceiling for ASCII code', () => {
    expect(capForEmbedding('x'.repeat(20_000))).toHaveLength(8000)
  })

  it('cuts dense scripts well under the token limit', () => {
    const thai = 'ก'.repeat(8000)
    const out = capForEmbedding(thai)
    expect(out.length).toBeLessThanOrEqual(3900)
    expect(out.length).toBeGreaterThan(3000)
  })

  it('never splits an emoji surrogate pair', () => {
    const out = capForEmbedding('😀'.repeat(5000))
    expect(out.length % 2).toBe(0)
    expect(out.length / 2).toBeLessThanOrEqual(2600)
  })
})
