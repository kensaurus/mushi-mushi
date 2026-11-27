/**
 * @vitest-environment jsdom
 *
 * FILE: apps/admin/src/components/timeline/TimelineControls.test.tsx
 * PURPOSE: ADR 0072 roles on the Timeline:
 *          - a viewer gets Pin and Keep forever disabled with the reason as a
 *            tooltip (no click that ends in a 403); members and an unknown
 *            role keep them;
 *          - a run links to /ux-runs only for an operator; a builder gets the
 *            run named and a way to its screens on this page.
 */
import { act, createElement, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { canEditTimeline, KeepForeverButton, PinButton, RunLinks, VIEWER_EDIT_HINT } from './TimelineControls'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root
beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
})

const render = async (node: ReactElement) => {
  await act(async () => root.render(createElement(MemoryRouter, null, node)))
}

describe('who may change the timeline', () => {
  it('only a known viewer is held back', () => {
    expect(canEditTimeline('viewer')).toBe(false)
    expect(canEditTimeline('member')).toBe(true)
    expect(canEditTimeline('owner')).toBe(true)
    expect(canEditTimeline(null)).toBe(true)
  })

  it('disables Keep forever for a viewer, with the reason, and never calls the API', async () => {
    const onToggle = vi.fn()
    await render(createElement(KeepForeverButton, { pinned: false, canEdit: false, onToggle }))
    const btn = host.querySelector('button')!
    expect(btn.disabled).toBe(true)
    expect(btn.title).toBe(VIEWER_EDIT_HINT)
    await act(async () => btn.click())
    expect(onToggle).not.toHaveBeenCalled()
  })

  it('lets a member keep a shot forever', async () => {
    const onToggle = vi.fn()
    await render(createElement(KeepForeverButton, { pinned: false, canEdit: true, onToggle }))
    await act(async () => host.querySelector('button')!.click())
    expect(onToggle).toHaveBeenCalledTimes(1)
  })

  it('disables Pin for a viewer, with the reason on hover', async () => {
    const onPin = vi.fn()
    await render(createElement(PinButton, { label: 'Pin current screens', canEdit: false, busy: false, onPin }))
    expect(host.querySelector('button')!.disabled).toBe(true)
    expect((host.querySelector('span[title]') as HTMLElement).title).toBe(VIEWER_EDIT_HINT)
  })
})

describe('run links', () => {
  const runs = [
    { id: 'r1', local_run_id: '20261127-091500-ab3d', kind: 'scorecard', cost_usd: 0.12 },
    { id: 'r2', local_run_id: '20261126-091500-cd4e', kind: 'loop', cost_usd: null },
  ]

  it('links an operator to the run on /ux-runs', async () => {
    await render(createElement(RunLinks, { runs, isOperator: true, onShowScreens: vi.fn() }))
    const hrefs = [...host.querySelectorAll('a')].map((a) => a.getAttribute('href'))
    expect(hrefs).toEqual(['/ux-runs?view=scorecard&run=20261127-091500-ab3d', '/ux-runs?run=20261126-091500-cd4e'])
  })

  it('never links a builder to the operator-only page; it offers the screens on this page', async () => {
    const onShowScreens = vi.fn()
    await render(createElement(RunLinks, { runs, isOperator: false, onShowScreens }))
    expect(host.querySelectorAll('a[href^="/ux-runs"]')).toHaveLength(0)
    expect(host.textContent).toContain('Scorecard 20261127')
    expect(host.textContent).toContain('$0.12')
    const btn = [...host.querySelectorAll('button')].find((b) => b.textContent?.includes('See their screens'))!
    await act(async () => btn.click())
    expect(onShowScreens).toHaveBeenCalledTimes(1)
  })
})
