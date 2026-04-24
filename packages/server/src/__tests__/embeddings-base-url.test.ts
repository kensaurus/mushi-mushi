/**
 * Regression tests for `normalizeOpenAiBaseUrl`.
 *
 * Sentry MUSHI-MUSHI-SERVER-G/B (regressed 2026-04-23): the previous implementation
 * stripped exactly ONE trailing `/v1` segment, so a stored BYOK base URL with a
 * doubled prefix (`https://openrouter.ai/api/v1/v1`) leaked one suffix through and
 * produced `/api/v1/v1/embeddings` — a 404 from OpenRouter that broke the entire
 * RAG codebase index for projects on that gateway. The fix loops the strip so the
 * normaliser is idempotent against any number of trailing `/v1` segments.
 *
 * Pinning the matrix below in a vitest unit prevents the next "small refactor"
 * from re-introducing the bug.
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
  createTrace: () => ({
    id: 'test-trace',
    span: () => ({ end: () => {} }),
    end: async () => {},
  }),
}))
vi.mock('../../supabase/functions/_shared/byok.ts', () => ({
  resolveLlmKey: async () => null,
}))

import { normalizeOpenAiBaseUrl } from '../../supabase/functions/_shared/embeddings.ts'

describe('normalizeOpenAiBaseUrl', () => {
  it('returns the OpenAI default for empty / nullish input', () => {
    expect(normalizeOpenAiBaseUrl('')).toBe('https://api.openai.com')
    expect(normalizeOpenAiBaseUrl(null)).toBe('https://api.openai.com')
    expect(normalizeOpenAiBaseUrl(undefined)).toBe('https://api.openai.com')
    expect(normalizeOpenAiBaseUrl('   ')).toBe('https://api.openai.com')
  })

  it('passes through a clean base URL with no trailing /v1', () => {
    expect(normalizeOpenAiBaseUrl('https://api.openai.com')).toBe('https://api.openai.com')
    expect(normalizeOpenAiBaseUrl('https://openrouter.ai/api')).toBe('https://openrouter.ai/api')
    expect(normalizeOpenAiBaseUrl('https://api.together.xyz')).toBe('https://api.together.xyz')
  })

  it('strips a single trailing /v1 (the OpenAI SDK convention)', () => {
    expect(normalizeOpenAiBaseUrl('https://openrouter.ai/api/v1')).toBe('https://openrouter.ai/api')
    expect(normalizeOpenAiBaseUrl('https://api.openai.com/v1')).toBe('https://api.openai.com')
  })

  it('strips a trailing slash before /v1', () => {
    expect(normalizeOpenAiBaseUrl('https://openrouter.ai/api/v1/')).toBe('https://openrouter.ai/api')
    expect(normalizeOpenAiBaseUrl('https://openrouter.ai/api/v1//')).toBe('https://openrouter.ai/api')
  })

  it('strips multiple trailing /v1 segments idempotently (MUSHI-MUSHI-SERVER-G/B regression)', () => {
    // The exact shape that broke the glot.it repo index 15 times in production
    // on 2026-04-23. The single-shot regex stripped one /v1 and left the second.
    expect(normalizeOpenAiBaseUrl('https://openrouter.ai/api/v1/v1')).toBe('https://openrouter.ai/api')
    expect(normalizeOpenAiBaseUrl('https://openrouter.ai/api/v1/v1/')).toBe('https://openrouter.ai/api')
    expect(normalizeOpenAiBaseUrl('https://openrouter.ai/api/v1/v1/v1')).toBe('https://openrouter.ai/api')
  })

  it('is case-insensitive on the version segment', () => {
    expect(normalizeOpenAiBaseUrl('https://openrouter.ai/api/V1')).toBe('https://openrouter.ai/api')
    expect(normalizeOpenAiBaseUrl('https://openrouter.ai/api/V1/v1')).toBe('https://openrouter.ai/api')
  })

  it('produces a final URL that lands on /v1/embeddings when callers append /v1/embeddings', () => {
    // This is the contract the embeddings call relies on. Simulate the full
    // path construction for every input variant.
    const inputs = [
      'https://openrouter.ai/api',
      'https://openrouter.ai/api/v1',
      'https://openrouter.ai/api/v1/',
      'https://openrouter.ai/api/v1/v1',
    ]
    for (const input of inputs) {
      const url = `${normalizeOpenAiBaseUrl(input)}/v1/embeddings`
      expect(url).toBe('https://openrouter.ai/api/v1/embeddings')
    }
  })
})
