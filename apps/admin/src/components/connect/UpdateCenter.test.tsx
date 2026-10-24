/**
 * @vitest-environment jsdom
 */

/**
 * An open upgrade PR used to keep the CI chip sdk-release-sync last wrote
 * ("CI failing") and offered only "View PR" and "Check CI status". A green
 * PR now offers Merge, which asks first and goes through the gated merge.
 * The lockfile line stays: the upgrade worker still does not write one.
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const hook = vi.hoisted(() => ({
  mergePr: vi.fn(),
  syncStatus: vi.fn(),
  state: {} as Record<string, unknown>,
}))

vi.mock('../../lib/useSdkUpgrade', () => ({
  useSdkUpgrade: () => ({
    state: hook.state,
    createUpgradePr: vi.fn(),
    refreshUpgradePr: vi.fn(),
    mergePr: hook.mergePr,
    syncStatus: hook.syncStatus,
  }),
}))

import { UpdateCenter } from './UpdateCenter'
import type { PreflightState } from '../../lib/useDispatchPreflight'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver

const PROJECT = {
  id: 'p-photo',
  sdk_package: '@mushi-mushi/react-native',
  sdk_version: '0.24.0',
  sdk_latest_version: '0.24.3',
  sdk_status: 'outdated' as const,
}
const PREFLIGHT = {
  loading: false,
  ready: true,
  checks: [{ key: 'github', ready: true }],
  failing: [],
  error: null,
  reload: () => {},
  repoUrl: 'https://github.com/kensaurus/help-her-take-photo',
} as unknown as PreflightState

const PR_URL = 'https://github.com/kensaurus/help-her-take-photo/pull/137'

function openPr(conclusion: 'failure' | 'success') {
  return {
    status: 'completed',
    jobId: 'job-137',
    prUrl: PR_URL,
    plan: [{ package: '@mushi-mushi/react-native', from: '0.24.0', to: '0.24.3' }],
    prState: 'open',
    checkRunStatus: 'completed',
    checkRunConclusion: conclusion,
  }
}

const button = (label: RegExp) =>
  Array.from(document.body.querySelectorAll('button')).find((b) =>
    label.test((b.textContent ?? '').replace(/\s+/g, ' ').trim()),
  )

describe('UpdateCenter upgrade PR', () => {
  let host: HTMLDivElement
  let root: Root

  beforeEach(() => {
    hook.mergePr.mockReset()
    hook.syncStatus.mockReset()
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
      root.render(createElement(MemoryRouter, null, createElement(UpdateCenter, { project: PROJECT, preflight: PREFLIGHT })))
    })
  }

  it('shows CI failing and no Merge while the checks are red', () => {
    hook.state = openPr('failure')
    render()
    const text = host.textContent ?? ''
    expect(text).toContain('is open (to 0.24.3)')
    expect(text).toContain('CI failing')
    expect(text).toContain('run your package manager after merging')
    expect(host.querySelector(`a[href="${PR_URL}"]`)).toBeTruthy()
    expect(button(/^Merge$/)).toBeUndefined()
    expect(text).toContain('Check CI status')
  })

  it('shows CI passing and merges only after confirm', () => {
    hook.state = openPr('success')
    render()
    const text = host.textContent ?? ''
    expect(text).toContain('CI passing')
    expect(text).toContain('run your package manager after merging')
    expect(button(/^Merge$/)).toBeTruthy()

    act(() => button(/^Merge$/)!.click())
    expect(hook.mergePr).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('same review gate')

    act(() => button(/^Merge PR$/)!.click())
    expect(hook.mergePr).toHaveBeenCalledWith('job-137')
  })
})
