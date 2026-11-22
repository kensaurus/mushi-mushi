/**
 * @vitest-environment jsdom
 */

/**
 * QA bug 32: "Merge all ready (N)" squash-merged N GitHub PRs on one click, and
 * "Open PRs (N)" opened N PRs, with no preview. Both now confirm first and
 * list every repo and PR they will touch.
 *
 * 2026-11-18 round 2: the bulk actions live in the header of "What needs you, per app"
 * and each app's Open PR in its SDK cell (the separate upgrade card repeated every
 * version pair), so these render ProjectNextStepsPanel.
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Project } from './project-models'

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
vi.mock('../ProjectFavicon', () => ({ ProjectFavicon: () => null }))

import { ProjectNextStepsPanel } from './ProjectNextStepsPanel'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function project(overrides: Partial<Project>): Project {
  return {
    id: 'p',
    name: 'app',
    slug: 'app',
    created_at: '2026-01-01T00:00:00Z',
    organization_id: null,
    organization_role: null,
    api_keys: [{ id: 'k1', key_prefix: 'mushi_abc', created_at: '2026-01-01T00:00:00Z', is_active: true, revoked: false, last_seen_at: '2026-07-01T00:00:00Z' }],
    active_key_count: 1,
    member_count: 1,
    members: [],
    report_count: 5,
    last_report_at: '2026-07-01T00:00:00Z',
    pdca_bottleneck: null,
    pdca_bottleneck_label: null,
    primary_repo: { repo_url: 'https://github.com/acme/app' } as Project['primary_repo'],
    sdk_version: '1.35.0',
    sdk_latest_version: '1.37.0',
    sdk_status: 'outdated',
    ...overrides,
  }
}

const READY = project({ id: 'p-ready', name: 'Glot', slug: 'glot' })
const IDLE = project({ id: 'p-idle', name: 'Yen', slug: 'yen' })

const button = (label: RegExp) =>
  Array.from(document.body.querySelectorAll('button')).find((b) => label.test(b.textContent ?? '')) as HTMLButtonElement

describe('bulk SDK upgrade actions in "What needs you, per app"', () => {
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
      root.render(createElement(MemoryRouter, null, createElement(ProjectNextStepsPanel, { projects: [READY, IDLE] })))
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

  it('puts the bulk buttons in the table header, and no second card lists the versions again', () => {
    expect(container.querySelector('[data-testid="project-needs"] [data-testid="bulk-upgrade-toolbar"]')).not.toBeNull()
    expect(container.textContent).not.toContain('SDK version upgrades')
    // Each version pair shows once, in its row.
    expect(container.textContent!.split('1.35.0 → 1.37.0').length - 1).toBe(2)
    // No slug pill repeating the name.
    expect(container.querySelector('code')).toBeNull()
  })
})

describe('upgradeJobSuperseded (2026-11-16: October jobs blocked the 0.24.7 upgrade)', () => {
  it('a job that bumped this SDK to an older release is superseded', async () => {
    const { upgradeJobSuperseded } = await import('./BulkSdkUpgradePanel')
    const project = { sdk_package: '@mushi-mushi/react-native', sdk_latest_version: '0.24.7' }
    expect(upgradeJobSuperseded([{ package: '@mushi-mushi/react-native', to: '0.24.4' }], project)).toBe(true)
    expect(upgradeJobSuperseded([{ package: '@mushi-mushi/core', to: '1.33.4' }], project)).toBe(true)
    expect(upgradeJobSuperseded([{ package: '@mushi-mushi/react-native', to: '0.24.7' }], project)).toBe(false)
    expect(upgradeJobSuperseded(undefined, project)).toBe(false)
    expect(upgradeJobSuperseded([{ package: '@mushi-mushi/react-native', to: '0.24.4' }], { ...project, sdk_latest_version: null })).toBe(false)
  })
})

describe('up-to-date rows (fresh-eyes review 2026-11-18: "Open PRs (9)" beside 7 apps behind)', () => {
  it('hides Open PR on a row the catalog marks up to date and leaves it out of the count', () => {
    hook.state = {}
    const current = project({ id: 'p-cur', name: 'Kensaurus', slug: 'k', sdk_version: '1.37.0', sdk_latest_version: '1.37.0', sdk_status: 'up-to-date' })
    const behind = project({ id: 'p-old', name: 'Lets', slug: 'l', sdk_version: '1.35.0', sdk_latest_version: '1.37.0', sdk_status: 'outdated' })
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    act(() => {
      root.render(createElement(MemoryRouter, null, createElement(ProjectNextStepsPanel, { projects: [current, behind] })))
    })
    const rowButtons = Array.from(container.querySelectorAll('button')).map((b) => b.getAttribute('aria-label') ?? '')
    expect(rowButtons).toContain('Open SDK bump PR for Lets')
    expect(rowButtons).not.toContain('Open SDK bump PR for Kensaurus')
    expect(button(/Open PRs \(1\)/)).toBeTruthy()
    act(() => root.unmount())
    container.remove()
  })
})
