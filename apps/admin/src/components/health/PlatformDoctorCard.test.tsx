/**
 * @vitest-environment jsdom
 *
 * The server doctor card on /health: super-admins only (app owners never
 * fetch it or see it), platform secret checks first, failures first.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ superAdmin: false, data: null as unknown, paths: [] as Array<string | null> }))

vi.mock('../../lib/useEntitlements', () => ({ useEntitlements: () => ({ isSuperAdmin: state.superAdmin }) }))
vi.mock('../../lib/usePageData', () => ({
  usePageData: (path: string | null) => {
    state.paths.push(path)
    return { data: path ? state.data : null, loading: false, error: null, isValidating: false, reload: vi.fn(), lastFetchedAt: null }
  },
}))

import { orderDoctorChecks, PlatformDoctorCard } from './PlatformDoctorCard'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root
let host: HTMLDivElement
beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  state.paths = []
  state.data = {
    status: 'fail',
    checks: [
      { name: 'recovery_token', status: 'pass', summary: 'internal_caller_token configured.' },
      { name: 'platform_linear_oauth', status: 'pass', summary: 'Set.' },
      { name: 'platform_slack_oauth', status: 'fail', summary: 'SLACK_CLIENT_SECRET is not set on the server, so "Add to Slack" for every app fails.', hint: 'Set SLACK_CLIENT_SECRET as function secrets.' },
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

describe('PlatformDoctorCard', () => {
  it('an app owner never fetches or sees it', async () => {
    await render()
    expect(state.paths.every((p) => p === null)).toBe(true)
    expect(host.querySelector('[data-testid="platform-doctor"]')).toBeNull()
  })

  it('a super-admin sees the platform checks first, failures first', async () => {
    state.superAdmin = true
    await render()
    expect(state.paths).toContain('/v1/admin/doctor')
    const names = [...host.querySelectorAll('[data-testid^="doctor-check-"]')].map((li) => li.getAttribute('data-testid'))
    expect(names).toEqual(['doctor-check-platform_slack_oauth', 'doctor-check-platform_linear_oauth', 'doctor-check-recovery_token'])
    expect(host.textContent).toContain('SLACK_CLIENT_SECRET is not set')
    expect(host.textContent).toContain('only you see this')
  })

  it('orders platform before the rest and failures before passes', () => {
    expect(
      orderDoctorChecks([
        { name: 'b', status: 'pass', summary: '' },
        { name: 'a', status: 'fail', summary: '' },
        { name: 'platform_x', status: 'pass', summary: '' },
      ]).map((c) => c.name),
    ).toEqual(['platform_x', 'a', 'b'])
  })
})
