/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/components/fullstack-audit/DatabaseHealthCard.test.tsx
 * PURPOSE: Database health says what state the app's Supabase project is in
 *          and what to do: the grade, size against the tier, cache, sharing,
 *          advice and the top issues with fix links; and, when the app is not
 *          linked, the one setting to fill in.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ data: null as unknown, loading: false, error: null as string | null }))
vi.mock('../../lib/usePageData', () => ({
  usePageData: () => ({ data: state.data, loading: state.loading, error: state.error, reload: vi.fn() }),
}))

import { DatabaseHealthCard, sizeLine } from './DatabaseHealthCard'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root
const render = () => act(() => root.render(createElement(MemoryRouter, null, createElement(DatabaseHealthCard, { projectId: 'p1' }))))

beforeEach(() => {
  state.data = null
  state.loading = false
  state.error = null
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

const HEALTH = {
  grade: 'act' as const,
  tier: { name: 'Micro', memoryGb: 1, recommendedMaxGb: 10, monthlyUsd: 10 },
  sizeMb: 1934,
  sizePctOfRecommended: 19,
  cacheHitPct: 99.95,
  connections: 18,
  maxConnections: 60,
  statsReset: '2026-10-14T05:00:00Z',
  counts: { error: 1, warn: 134, info: 330 },
  top: [{ name: 'security_definer_view', title: 'Security Definer View', level: 'ERROR' as const, category: 'security' as const, count: 1, remediation: 'https://supabase.com/docs/x' }],
  advice: ['Fix the 1 error first: security definer view.'],
}

describe('DatabaseHealthCard', () => {
  it('shows the grade, the facts, who shares the project, the advice and fix links', () => {
    state.data = { projectRef: 'jghcferpoaqntpfqvayf', sharedWith: ['lets-talk', 'the-wanting-mind'], health: HEALTH }
    render()
    const text = container.textContent ?? ''
    expect(text).toContain('Needs a fix')
    expect(text).toContain('shared with lets-talk, the-wanting-mind')
    expect(text).toContain('1.9 GB of 10 GB recommended (Micro, 1 GB memory, about $10/mo)')
    expect(text).toContain('18 of 60 connections in use')
    expect(text).toContain('Fix the 1 error first')
    expect(text).toContain('1 error, 134 warnings, 330 suggestions')
    expect(container.querySelector('a[href="https://supabase.com/docs/x"]')?.textContent).toContain('How to fix')
  })

  it('names the one setting to fill in when the app is not linked', () => {
    state.data = { projectRef: null, reason: 'no_project_ref' }
    render()
    expect(container.querySelector('a[href="/settings?tab=general"]')?.textContent).toBe('Settings → General → Supabase project')
    state.data = { projectRef: null, reason: 'no_supabase_pat' }
    render()
    expect(container.querySelector('a[href="/settings?tab=byok"]')).not.toBeNull()
  })

  it('says it is reading, never "not linked", while the read runs', () => {
    state.loading = true
    render()
    expect(container.textContent).toContain('Reading your Supabase project…')
    expect(container.textContent).not.toContain('Settings →')
  })

  it('says when the stats could not be read, instead of hiding them', () => {
    state.data = { projectRef: 'ref', health: { ...HEALTH, sizeMb: null, cacheHitPct: null, connections: null }, statsError: 'execute_sql returned no rows Mushi could read' }
    render()
    expect(container.textContent).toContain('Size, cache and connections could not be read this time')
  })

  it('lists where time and space go, and says why a list is empty', () => {
    const hotspots = {
      slow: null,
      slowSince: null,
      tables: [{ name: 'public.cron_runs', bytes: 180 * 1_048_576, rows: 133_723, dead: 17_223 }],
      unusedIndexes: [{ name: 'public.idx_cron_runs_job_started', table: 'cron_runs', bytes: 12 * 1_048_576 }],
    }
    state.data = { projectRef: 'ref', health: { ...HEALTH, hotspots } }
    render()
    const text = container.querySelector('[data-testid="database-hotspots"]')?.textContent ?? ''
    expect(text).toContain('Query timings could not be read')
    expect(text).toContain('public.cron_runs180 MB · about 133,723 rows · 17,223 dead rows')
    expect(text).toContain('Unused indexes (1, 12 MB)')
  })

  it('sizeLine without a known tier is just the size', () => {
    expect(sizeLine({ ...HEALTH, tier: null, sizeMb: 512 })).toBe('512 MB')
  })
})
