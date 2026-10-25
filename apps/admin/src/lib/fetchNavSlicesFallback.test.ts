/**
 * FILE: apps/admin/src/lib/fetchNavSlicesFallback.test.ts
 * PURPOSE: The nav-meta fallback does not carry timestamps the checks page
 *          never renders: newest content edit, last lesson reinforcement.
 */

import { describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => {
  function dataFor(path: string): Record<string, unknown> {
    if (path === '/v1/admin/content-quality/stats') {
      return {
        openCount: 2,
        inReviewCount: 0,
        regeneratingCount: 0,
        userFlagOpenCount: 0,
        failedRegenCount: 0,
        needsAttentionCount: 2,
        latestAt: '2026-10-25T12:00:00Z',
        topPriority: 'open_issues',
      }
    }
    if (path === '/v1/admin/lessons/stats') {
      return {
        activeLessons: 3,
        readyToPromote: 1,
        criticalLessons: 2,
        lastLessonReinforcedAt: '2026-10-25T12:00:00Z',
        topPriority: 'critical_lessons',
      }
    }
    return {}
  }
  return {
    apiFetch: (path: string) => Promise.resolve({ ok: true as const, data: dataFor(path) }),
  }
})

vi.mock('./supabase', () => ({ apiFetch: (path: string) => api.apiFetch(path) }))

import { fetchNavSlicesFallback } from './fetchNavSlicesFallback'

describe('fetchNavSlicesFallback', () => {
  it('drops content latestAt and lesson reinforcement time the checks cards do not render', async () => {
    const slices = await fetchNavSlicesFallback('proj-1')
    expect(slices.contentQuality).toMatchObject({ openCount: 2, needsAttentionCount: 2, topPriority: 'open_issues' })
    expect(slices.contentQuality).not.toHaveProperty('latestAt')
    expect(slices.lessons).toMatchObject({ criticalLessons: 2, readyToPromote: 1, topPriority: 'critical_lessons' })
    expect(slices.lessons).not.toHaveProperty('lastLessonReinforcedAt')
  })
})
