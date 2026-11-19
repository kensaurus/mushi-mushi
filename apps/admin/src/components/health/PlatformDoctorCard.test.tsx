/**
 * @vitest-environment jsdom
 *
 * The server doctor card on /health: super-admins only (app owners never
 * fetch it or see it); problems first with their fix button; the app's name,
 * never `codebase_index:<uuid>`; optional extras and passing checks collapsed
 * into counted disclosures.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ superAdmin: false, data: null as unknown, paths: [] as Array<string | null>, posts: [] as string[] }))

vi.mock('../../lib/useEntitlements', () => ({ useEntitlements: () => ({ isSuperAdmin: state.superAdmin }) }))
vi.mock('../../lib/usePageData', () => ({
  usePageData: (path: string | null) => {
    state.paths.push(path)
    return { data: path ? state.data : null, loading: false, error: null, isValidating: false, reload: vi.fn(), lastFetchedAt: null }
  },
}))
vi.mock('../../lib/supabase', () => ({
  apiFetch: async (path: string) => {
    state.posts.push(path)
    return { ok: true, data: {} }
  },
}))

import { orderDoctorChecks, PlatformDoctorCard } from './PlatformDoctorCard'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const UUID = '1000000a-0000-4000-8000-000000000000'

let root: Root
let host: HTMLDivElement
beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  state.paths = []
  state.posts = []
  state.data = {
    status: 'fail',
    checks: [
      { name: 'recovery_token', status: 'pass', label: 'Background job token', summary: 'internal_caller_token configured.' },
      { name: 'platform_linear_oauth', status: 'pass', summary: 'Set.' },
      { name: 'platform_slack_oauth', status: 'fail', summary: 'SLACK_CLIENT_SECRET is not set on the server, so "Add to Slack" for every app fails.', hint: 'Set SLACK_CLIENT_SECRET as function secrets.' },
      { name: `codebase_index:${UUID}`, status: 'warn', label: 'Code index', projectId: UUID, appName: 'glot.it', summary: 'Index stalled.', hint: 'Re-index it.' },
      { name: 'observability', status: 'info', label: 'Tracing and error tracking', summary: 'Langfuse: off; Sentry: off.' },
    ],
  }
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

async function render() {
  await act(async () => {
    root.render(createElement(MemoryRouter, null, createElement(PlatformDoctorCard)))
  })
}

const ids = () => [...host.querySelectorAll('[data-testid^="doctor-check-"]')].map((li) => li.getAttribute('data-testid'))

describe('PlatformDoctorCard', () => {
  it('an app owner never fetches or sees it', async () => {
    await render()
    expect(state.paths.every((p) => p === null)).toBe(true)
    expect(host.querySelector('[data-testid="platform-doctor"]')).toBeNull()
  })

  it('a super-admin sees problems first (platform first among equals), then optional, then OK', async () => {
    state.superAdmin = true
    await render()
    expect(state.paths).toContain('/v1/admin/doctor')
    expect(ids()).toEqual([
      'doctor-check-platform_slack_oauth',
      `doctor-check-codebase_index:${UUID}`,
      'doctor-check-observability',
      'doctor-check-platform_linear_oauth',
      'doctor-check-recovery_token',
    ])
    expect(host.textContent).toContain('SLACK_CLIENT_SECRET is not set')
    expect(host.textContent).toContain('only you see this')
  })

  it('a per-app row leads with the app name and the label, never the uuid', async () => {
    state.superAdmin = true
    await render()
    const row = host.querySelector(`[data-testid="doctor-check-codebase_index:${UUID}"]`)!
    expect(row.textContent).toContain('Code index')
    expect(row.textContent).toContain('glot.it')
    expect(row.textContent).not.toContain(UUID)
  })

  it('optional and passing checks collapse into counted disclosures', async () => {
    state.superAdmin = true
    await render()
    const ok = host.querySelector('[data-testid="doctor-ok"]') as HTMLDetailsElement
    const optional = host.querySelector('[data-testid="doctor-optional"]') as HTMLDetailsElement
    expect(ok.open).toBe(false)
    expect(ok.querySelector('summary')!.textContent).toContain('2 checks OK')
    expect(optional.querySelector('summary')!.textContent).toContain('1 optional, not set up')
  })

  it('the code index problem has a Re-index button that starts the sweep here', async () => {
    state.superAdmin = true
    await render()
    const row = host.querySelector(`[data-testid="doctor-check-codebase_index:${UUID}"]`)!
    const btn = [...row.querySelectorAll('button')].find((b) => b.textContent?.includes('Re-index'))!
    await act(async () => {
      btn.click()
    })
    expect(state.posts).toEqual([`/v1/admin/projects/${UUID}/codebase/sweep`])
  })

  it('no problems reads as one all-clear line', async () => {
    state.superAdmin = true
    state.data = { status: 'pass', checks: [{ name: 'recovery_token', status: 'pass', summary: 'ok' }] }
    await render()
    expect(host.querySelector('[data-testid="doctor-all-clear"]')).not.toBeNull()
  })

  it('orders failures before warnings before passes, platform first within a status', () => {
    expect(
      orderDoctorChecks([
        { name: 'b', status: 'pass', summary: '' },
        { name: 'a', status: 'fail', summary: '' },
        { name: 'platform_x', status: 'pass', summary: '' },
        { name: 'w', status: 'warn', summary: '' },
      ]).map((c) => c.name),
    ).toEqual(['a', 'w', 'platform_x', 'b'])
  })
})
