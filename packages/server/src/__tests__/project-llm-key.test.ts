/**
 * projectLlmKey returns null both when nothing is configured and when the
 * monthly budget is spent. Callers that skip a project (mistake-clusterer)
 * need those two misses told apart; a thrown budget error would fail the job.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const resolve = vi.hoisted(() => ({
  fn: vi.fn<(...args: unknown[]) => Promise<{ key: string; source: 'byok'; hint: string } | null>>(
    async () => null,
  ),
}))

vi.mock('../../supabase/functions/_shared/byok.ts', () => ({
  resolveLlmKey: (...args: unknown[]) => resolve.fn(...args),
}))

import { LlmBudgetExceededError } from '../../supabase/functions/_shared/llm-budget.ts'
import { projectLlmKey } from '../../supabase/functions/_shared/project-llm-key.ts'

const db = {} as never

beforeEach(() => {
  resolve.fn.mockReset()
})

describe('projectLlmKey miss reasons', () => {
  it('reports budget_exhausted when the monthly budget is spent, and still returns null', async () => {
    resolve.fn.mockRejectedValueOnce(new LlmBudgetExceededError('p1', 6, 5, '2026-11-01T00:00:00.000Z'))
    const reasons: string[] = []
    const key = await projectLlmKey(db, 'p1', 'anthropic', (reason) => reasons.push(reason))
    expect(key).toBeNull()
    expect(reasons).toEqual(['budget_exhausted'])
  })

  it('reports unconfigured when resolution finds no key', async () => {
    resolve.fn.mockResolvedValueOnce(null)
    const reasons: string[] = []
    const key = await projectLlmKey(db, 'p1', 'openai', (reason) => reasons.push(reason))
    expect(key).toBeNull()
    expect(reasons).toEqual(['unconfigured'])
  })

  it('returns a resolved key without reporting a miss', async () => {
    const resolved = { key: 'sk-test', source: 'byok' as const, hint: 'test' }
    resolve.fn.mockResolvedValueOnce(resolved)
    const reasons: string[] = []
    const key = await projectLlmKey(db, 'p1', 'anthropic', (reason) => reasons.push(reason))
    expect(key).toEqual(resolved)
    expect(reasons).toEqual([])
  })

  it('rethrows a resolution failure that is not a spent budget', async () => {
    resolve.fn.mockRejectedValueOnce(new Error('vault down'))
    await expect(projectLlmKey(db, 'p1', 'anthropic', () => {})).rejects.toThrow('vault down')
  })
})
