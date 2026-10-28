/**
 * FILE: apps/admin/src/pages/QaCoveragePage.storyCard.test.tsx
 * PURPOSE: Story card controls stay siblings. A card button that wraps Run
 *          fails axe nested-interactive. A skipped-only story shows no 0% rate.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../components/ProjectSwitcher', () => ({ useActiveProjectId: () => 'p1' }))

import { StoryCard } from './QaCoveragePage'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const coverage = {
  story_id: 's1',
  project_id: 'p1',
  name: 'Checkout',
  enabled: true,
  browser_provider: 'local',
  last_run_status: 'skipped',
  runs_24h: 3,
  passed_24h: 0,
  failed_24h: 0,
  error_24h: 0,
  pass_rate_pct: null as number | null,
  last_run_at: '2026-10-28T00:00:00.000Z',
  last_failure_url: 'https://example.com/replay',
}

let root: Root
let host: HTMLDivElement

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
})

describe('StoryCard controls', () => {
  it('keeps Run and Replay outside the open button', async () => {
    const onSelect = vi.fn()
    const onRunNow = vi.fn()
    await act(async () => {
      root.render(createElement(StoryCard, { coverage, isQueued: false, onRunNow, onSelect, highlighted: false }))
    })

    const open = host.querySelector('button[aria-label="Open Checkout"]')
    const play = host.querySelector('button[aria-label="Run Checkout now"]')
    const replay = host.querySelector('a[href="https://example.com/replay"]')
    expect(open).toBeTruthy()
    expect(play).toBeTruthy()
    expect(replay).toBeTruthy()
    expect(open!.contains(play!)).toBe(false)
    expect(open!.contains(replay!)).toBe(false)
    expect(play!.closest('[role="button"]')).toBeNull()
    expect(host.textContent).toContain('skipped')
    expect(host.textContent).not.toContain('0%')

    await act(async () => { (open as HTMLButtonElement).click() })
    expect(onSelect).toHaveBeenCalledWith('s1')
    expect(onRunNow).not.toHaveBeenCalled()

    onSelect.mockClear()
    await act(async () => { (play as HTMLButtonElement).click() })
    expect(onRunNow).toHaveBeenCalledWith('s1')
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('still shows a real 0% when finished runs failed', async () => {
    await act(async () => {
      root.render(createElement(StoryCard, {
        coverage: { ...coverage, last_run_status: 'failed', pass_rate_pct: 0, failed_24h: 3, last_failure_url: null },
        isQueued: false,
        onRunNow: vi.fn(),
        onSelect: vi.fn(),
        highlighted: false,
      }))
    })
    expect(host.textContent).toContain('0%')
    expect(host.textContent).toContain('failed')
  })
})
