/**
 * FILE: apps/admin/src/components/connect/UpdateCenter.test.tsx
 * PURPOSE: Connect's update center. Once an upgrade PR is merged and a newer
 *          release is out, the old PR is history: the page offered its "View
 *          PR", "Check CI status" and change table beside the new upgrade
 *          (journey walk, 2026-11-28). Only the new upgrade leads now.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const upgrade = vi.hoisted(() => ({ state: { status: 'idle' } as Record<string, unknown> }))
vi.mock('../../lib/useSdkUpgrade', () => ({
  useSdkUpgrade: () => ({ state: upgrade.state, createUpgradePr: vi.fn(), refreshUpgradePr: vi.fn(), syncStatus: vi.fn() }),
}))

import { UpdateCenter } from './UpdateCenter'
import type { PreflightState } from '../../lib/useDispatchPreflight'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
// jsdom has no ResizeObserver; the change table measures itself with one.
;(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const preflight = {
  loading: false,
  ready: true,
  checks: [{ key: 'github', ready: true, label: 'GitHub', hint: '', fixHref: '/connect' }],
  failing: [],
  error: null,
  reload: () => {},
  repoUrl: 'https://github.com/o/r',
} as unknown as PreflightState

const project = { id: 'p1', sdk_package: '@mushi-mushi/web', sdk_version: '1.35.0', sdk_latest_version: '1.40.0', sdk_status: 'outdated' }

let host: HTMLDivElement
let root: Root
beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

function render() {
  act(() => {
    root.render(createElement(MemoryRouter, null, createElement(UpdateCenter, { project, preflight } as never)))
  })
}

const mergedOldPr = {
  status: 'completed',
  jobId: 'j1',
  prUrl: 'https://github.com/o/r/pull/277',
  prState: 'merged',
  plan: [{ package: '@mushi-mushi/web', from: '1.33.3', to: '1.35.0', file: 'package.json' }],
  checkedAt: Date.now(),
}

describe('UpdateCenter', () => {
  it('leads with the one new upgrade once the old PR is merged and a newer release is out', () => {
    upgrade.state = mergedOldPr
    render()
    const text = host.textContent ?? ''
    expect(text).toContain('Upgrade to 1.40.0')
    expect(text).not.toContain('View PR')
    expect(text).not.toContain('Check CI status')
    expect(text).not.toContain('What the upgrade PR changes')
  })

  it('still offers the open PR and its CI while it is open', () => {
    upgrade.state = { ...mergedOldPr, prState: 'open', plan: [{ package: '@mushi-mushi/web', from: '1.35.0', to: '1.40.0', file: 'package.json' }] }
    render()
    const text = host.textContent ?? ''
    expect(text).toContain('View PR')
    expect(text).toContain('Check CI status')
    expect(text).toContain('What the upgrade PR changes')
  })
})
