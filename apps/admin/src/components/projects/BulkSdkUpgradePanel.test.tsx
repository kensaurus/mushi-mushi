/**
 * @vitest-environment jsdom
 */

/**
 * QA bug 32: "Merge all ready (N)" squash-merged N GitHub PRs on one click, and
 * "Open PRs (N)" opened N PRs, with no preview. Both now confirm first and
 * list every repo and PR they will touch.
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const hook = vi.hoisted(() => ({
  mergePr: vi.fn(),
  createUpgradePr: vi.fn(),
  state: {} as Record<string, Record<string, unknown>>,
}))

vi.mock('../../lib/useSdkUpgrade', () => ({
  useSdkUpgrade: (projectId: string) => ({
    state: hook.state[projectId] ?? { status: 'idle' },
    createUpgradePr: hook.createUpgradePr,
    refreshUpgradePr: vi.fn(),
    mergePr: hook.mergePr,
    syncStatus: vi.fn(),
  }),
}))

import { BulkSdkUpgradePanel, type BulkUpgradeProject } from './BulkSdkUpgradePanel'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const READY: BulkUpgradeProject = { id: 'p-ready', name: 'Glot', slug: 'glot', hasRepo: true }
const IDLE: BulkUpgradeProject = { id: 'p-idle', name: 'Yen', slug: 'yen', hasRepo: true }

const button = (label: RegExp) =>
  Array.from(document.body.querySelectorAll('button')).find((b) => label.test(b.textContent ?? '')) as HTMLButtonElement

describe('BulkSdkUpgradePanel bulk actions', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    hook.mergePr.mockReset()
    hook.createUpgradePr.mockReset()
    hook.state = {
      'p-ready': {
        status: 'completed',
        jobId: 'job-1',
        prUrl: 'https://github.com/acme/glot/pull/42',
        releaseStatus: 'ready_to_merge',
      },
    }
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => {
      root.render(createElement(MemoryRouter, null, createElement(BulkSdkUpgradePanel, { projects: [READY, IDLE] })))
    })
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('Merge all ready asks first, lists each PR, and merges only on confirm', () => {
    act(() => button(/Merge all ready \(1\)/).click())
    expect(hook.mergePr).not.toHaveBeenCalled()
    const list = document.body.querySelector('[data-testid="bulk-upgrade-confirm-list"]')!.textContent ?? ''
    expect(list).toContain('Glot')
    expect(list).toContain('acme/glot#42')
    expect(list).not.toContain('Yen')

    act(() => button(/^Merge 1$/).click())
    expect(hook.mergePr).toHaveBeenCalledWith('job-1')
  })

  it('Open PRs asks first and lists the repos it will push to', () => {
    act(() => button(/Open PRs \(1\)/).click())
    expect(hook.createUpgradePr).not.toHaveBeenCalled()
    expect(document.body.querySelector('[data-testid="bulk-upgrade-confirm-list"]')!.textContent).toContain('Yen')
    act(() => button(/^Cancel$/).click())
    expect(hook.createUpgradePr).not.toHaveBeenCalled()
  })
})
