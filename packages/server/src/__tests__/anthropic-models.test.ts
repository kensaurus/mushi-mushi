/**
 * FILE: packages/server/src/__tests__/anthropic-models.test.ts
 * PURPOSE: GET /v1/admin/byok/anthropic/models feeds the settings model
 *          pickers (ADR 0039). Only claude-* ids reach the console, newest
 *          first, and Anthropic is asked at most once an hour per key.
 */

import { describe, expect, it, vi } from 'vitest'
import { listAnthropicModels, parseAnthropicModels } from '../../supabase/functions/api/routes/anthropic-models.ts'

const BODY = {
  data: [
    { id: 'claude-haiku-5-5', display_name: 'Claude Haiku 5.5', created_at: '2026-10-07T00:00:00Z', max_input_tokens: 1_000_000, line: 'haiku' },
    { id: 'claude-opus-5-5', display_name: 'Claude Opus 5.5', created_at: '2026-09-22T00:00:00Z', max_input_tokens: 1_000_000, line: 'opus' },
    { id: 'not-a-claude-model', display_name: 'x', created_at: '2026-10-08T00:00:00Z' },
    { display_name: 'no id' },
  ],
}

describe('parseAnthropicModels', () => {
  it('keeps claude-* ids, newest first, with the picker fields', () => {
    expect(parseAnthropicModels(BODY)).toEqual([
      { id: 'claude-haiku-5-5', displayName: 'Claude Haiku 5.5', createdAt: '2026-10-07T00:00:00Z', maxInputTokens: 1_000_000, line: 'haiku' },
      { id: 'claude-opus-5-5', displayName: 'Claude Opus 5.5', createdAt: '2026-09-22T00:00:00Z', maxInputTokens: 1_000_000, line: 'opus' },
    ])
  })

  it('returns nothing for an unexpected body', () => {
    expect(parseAnthropicModels(null)).toEqual([])
    expect(parseAnthropicModels({ data: 'x' })).toEqual([])
  })
})

describe('listAnthropicModels', () => {
  it('sends the key and version headers, then serves the cache for an hour', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(BODY), { status: 200 }))
    const first = await listAnthropicModels('sk-test', 'k1', 1_000, fetchImpl as unknown as typeof fetch)
    expect(first.map((m) => m.id)).toEqual(['claude-haiku-5-5', 'claude-opus-5-5'])
    const init = (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1]
    expect((init.headers as Record<string, string>)['x-api-key']).toBe('sk-test')
    expect((init.headers as Record<string, string>)['anthropic-version']).toBe('2023-06-01')
    await listAnthropicModels('sk-test', 'k1', 1_000 + 59 * 60_000, fetchImpl as unknown as typeof fetch)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    await listAnthropicModels('sk-test', 'k1', 1_000 + 61 * 60_000, fetchImpl as unknown as typeof fetch)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('throws on a failed answer so the route reports "error" and the console uses its own list', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 401 }))
    await expect(listAnthropicModels('sk-bad', 'k2', 1_000, fetchImpl as unknown as typeof fetch)).rejects.toThrow(/401/)
  })
})
