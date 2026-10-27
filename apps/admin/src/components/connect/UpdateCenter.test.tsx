/**
 * FILE: apps/admin/src/components/connect/UpdateCenter.test.tsx
 * PURPOSE: The Update center offers Merge only when the upgrade PR's CI is green,
 *          and only after a confirm. A red check keeps View PR and Check CI.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PreflightState } from '../../lib/useDispatchPreflight'

const hook = vi.hoisted(() => ({
  mergePr: vi.fn(),
  syncStatus: vi.fn(),
  createUpgradePr: vi.fn(),
  refreshUpgradePr: vi.fn(),
  state: {} as Record<string, unknown>,
}))

vi.mock('../../lib/useSdkUpgrade', () => ({
  useSdkUpgrade: () => ({
    state: hook.state,
    createUpgradePr: hook.createUpgradePr,
    refreshUpgradePr: hook.refreshUpgradePr,
    mergePr: hook.mergePr,
    syncStatus: hook.syncStatus,
    cancel: vi.fn(),
    reset: vi.fn(),
  }),
}))

import { UpdateCenter } from './UpdateCenter'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const PREFLIGHT: PreflightState = {
  loading: false,
  ready: true,
  checks: [{ key: 'github', ready: true, label: 'GitHub', hint: '', fixHref: '' }],
  failing: [],
  error: null,
  reload: () => {},
  repoUrl: 'https://github.com/acme/app',
}

const PROJECT = {
  id: 'p1',
  sdk_package: '@mushi-mushi/web',
  sdk_version: '1.0.0',
  sdk_latest_version: '1.2.0',
  sdk_status: 'outdated' as const,
}

function openPr(conclusion: 'success' | 'failure') {
  return {
    status: 'completed',
    jobId: 'job-1',
    prUrl: 'https://github.com/acme/app/pull/7',
    prState: 'open',
    checkRunStatus: 'completed',
    checkRunConclusion: conclusion,
    releaseStatus: conclusion === 'success' ? 'ready_to_merge' : 'blocked',
  }
}

const button = (label: RegExp) =>
  Array.from(document.body.querySelectorAll('button')).find((b) => label.test(b.textContent ?? '')) as HTMLButtonElement | undefined

describe('UpdateCenter merge', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    hook.mergePr.mockReset()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  function render() {
    act(() => {
      root.render(createElement(MemoryRouter, null, createElement(UpdateCenter, { project: PROJECT, preflight: PREFLIGHT })))
    })
  }

  it('asks before merging a green upgrade PR, and merges only on confirm', () => {
    hook.state = openPr('success')
    render()
    const merge = document.body.querySelector('[data-testid="update-center-merge"]') as HTMLButtonElement
    expect(merge).toBeTruthy()
    expect(document.body.textContent).toContain('CI passing')

    act(() => merge.click())
    expect(hook.mergePr).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('Merge upgrade PR #7 on GitHub?')

    act(() => button(/^Cancel$/)!.click())
    expect(hook.mergePr).not.toHaveBeenCalled()

    act(() => (document.body.querySelector('[data-testid="update-center-merge"]') as HTMLButtonElement).click())
    act(() => button(/^Merge PR$/)!.click())
    expect(hook.mergePr).toHaveBeenCalledTimes(1)
    expect(hook.mergePr).toHaveBeenCalledWith('job-1')
  })

  it('does not offer Merge while CI is failing', () => {
    hook.state = openPr('failure')
    render()
    expect(document.body.querySelector('[data-testid="update-center-merge"]')).toBeNull()
    expect(document.body.textContent).toContain('CI failing')
    expect(document.body.textContent).toContain('View PR')
    expect(document.body.textContent).toContain('Check CI status')
  })
})
