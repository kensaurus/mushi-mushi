/**
 * Recent LLM calls grouped by what they share (round 3, 2026-11-19), newest group first.
 */

import { describe, expect, it } from 'vitest'
import { groupRecentCalls } from './recentCalls'

const call = (fn: string, model: string, extra: Partial<{ fallback_used: boolean; status: string; key_source: string | null; at: string }> = {}) => ({
  function_name: fn,
  used_model: model,
  fallback_used: extra.fallback_used ?? false,
  status: extra.status ?? 'success',
  key_source: extra.key_source ?? 'byok',
  at: extra.at ?? '',
})

describe('groupRecentCalls', () => {
  it('folds identical calls into one group and keeps the order of first appearance', () => {
    const rows = [
      call('webhooks-github-indexer', 'text-embedding-3-small', { at: '1' }),
      call('classify-report', 'claude-haiku', { at: '2' }),
      call('webhooks-github-indexer', 'text-embedding-3-small', { at: '3' }),
    ]
    const groups = groupRecentCalls(rows)
    expect(groups.map((g) => [g.fn, g.rows.map((r) => r.at)])).toEqual([
      ['webhooks-github-indexer', ['1', '3']],
      ['classify-report', ['2']],
    ])
    expect(groups[0].keySource).toBe('byok')
  })

  it('splits a failed or fallback call from the clean ones, and drops the env key source', () => {
    const groups = groupRecentCalls([
      call('fix-worker', 'm', { key_source: 'env' }),
      call('fix-worker', 'm', { key_source: 'env', status: 'error' }),
      call('fix-worker', 'm', { key_source: 'env', fallback_used: true }),
    ])
    expect(groups).toHaveLength(3)
    expect(groups.every((g) => g.keySource === null)).toBe(true)
  })
})
