/**
 * @vitest-environment jsdom
 *
 * "Turn on" for Autofix on the report page (owner, 2026-11-17): it only
 * opened Integrations, where the person still had to find the toggle. With
 * GitHub ready it now turns Autofix on in place with a toast; without GitHub
 * it says "Connect GitHub first" and goes there.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ apiFetch: vi.fn() }))
vi.mock('../../lib/supabase', () => api)
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }))
vi.mock('../../lib/toast', () => ({ useToast: () => toast }))

import { DispatchPreflightBanner, stepAction } from './DispatchPreflightBanner'
import type { PreflightCheck, PreflightState } from '../../lib/useDispatchPreflight'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const PROJECT = '11111111-1111-4111-8111-111111111111'
const check = (key: PreflightCheck['key'], ready: boolean): PreflightCheck => ({
  key,
  ready,
  label: key,
  hint: '',
  fixHref: key === 'github' ? '/integrations/config#platform-card-github' : '/integrations/config#integrations-codebase',
})

function preflight(checks: PreflightCheck[], reload = vi.fn()): PreflightState {
  return { loading: false, ready: false, checks, failing: checks.filter((c) => !c.ready), error: null, reload, repoUrl: 'https://github.com/a/b' }
}

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  api.apiFetch.mockReset()
  toast.success.mockReset()
  toast.error.mockReset()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

function Where() {
  const loc = useLocation()
  return createElement('output', { 'data-testid': 'where' }, `${loc.pathname}${loc.hash}`)
}

function render(state: PreflightState, required?: boolean) {
  act(() =>
    root.render(
      createElement(
        MemoryRouter,
        { initialEntries: ['/reports/r1'] },
        createElement(Routes, null,
          createElement(Route, { path: '/reports/r1', element: createElement(DispatchPreflightBanner, { preflight: state, projectId: PROJECT, required }) }),
          createElement(Route, { path: '*', element: createElement(Where) }),
        ),
      ),
    ),
  )
}

const step = (key: string) => host.querySelector(`[data-testid="dispatch-step-${key}"]`) as HTMLButtonElement | null

async function flush() {
  for (let i = 0; i < 6; i += 1) await act(async () => { await Promise.resolve() })
}

describe('stepAction', () => {
  it('turns Autofix on in place when GitHub is ready, else names GitHub', () => {
    expect(stepAction(check('autofix', false), [check('github', true), check('autofix', false)])).toMatchObject({ label: 'Turn on', kind: 'turn_on_autofix' })
    expect(stepAction(check('autofix', false), [check('github', false), check('autofix', false)])).toEqual({
      label: 'Connect GitHub first',
      kind: 'go',
      href: '/integrations/config#platform-card-github',
    })
  })
})

describe('DispatchPreflightBanner', () => {
  it('"Turn on" switches Autofix on here, says so, and re-reads the steps', async () => {
    api.apiFetch.mockResolvedValue({ ok: true, data: { autofix_enabled: true } })
    const reload = vi.fn()
    render(preflight([check('github', true), check('autofix', false)], reload))
    expect(step('autofix')!.textContent).toBe('Turn on')
    act(() => step('autofix')!.click())
    await flush()
    expect(api.apiFetch).toHaveBeenCalledWith(`/v1/admin/projects/${PROJECT}/autofix/toggle`, expect.objectContaining({ method: 'POST', body: JSON.stringify({ enabled: true }) }))
    expect(toast.success).toHaveBeenCalledWith('Autofix is on', expect.any(String))
    expect(reload).toHaveBeenCalled()
    // It stayed on the report.
    expect(host.querySelector('[data-testid="where"]')).toBeNull()
  })

  it('a member who may not turn it on is told who can', async () => {
    api.apiFetch.mockResolvedValue({ ok: false, error: { code: 'FORBIDDEN', message: 'x' } })
    render(preflight([check('github', true), check('autofix', false)]))
    act(() => step('autofix')!.click())
    await flush()
    expect(toast.error).toHaveBeenCalledWith('Autofix is still off', expect.stringMatching(/owner or admin/))
  })

  it('without GitHub the button says "Connect GitHub first" and goes there', async () => {
    render(preflight([check('github', false), check('autofix', false)]))
    expect(step('autofix')!.textContent).toBe('Connect GitHub first')
    act(() => step('autofix')!.click())
    await flush()
    expect(api.apiFetch).not.toHaveBeenCalled()
    expect(host.querySelector('[data-testid="where"]')!.textContent).toBe('/integrations/config#platform-card-github')
  })
})

// A new user saw "Optional: …" in a closed card while both Dispatch fix buttons were disabled (feedback 2026-11-22).
describe('DispatchPreflightBanner when dispatch waits on it', () => {
  const checks = [check('github', false), check('codebase', true), check('agent', true), check('autofix', false)]

  it('drops "Optional" and starts open', () => {
    render(preflight(checks), true)
    const details = host.querySelector('[data-testid="dispatch-preflight"]') as HTMLDetailsElement
    expect(details.open).toBe(true)
    expect(details.querySelector('summary')?.textContent).toBe('Let Mushi Mushi dispatch the fix for you (2 steps left)')
  })

  it('stays an optional, closed card otherwise', () => {
    render(preflight(checks))
    const details = host.querySelector('[data-testid="dispatch-preflight"]') as HTMLDetailsElement
    expect(details.open).toBe(false)
    expect(details.querySelector('summary')?.textContent).toBe('Optional: let Mushi Mushi dispatch the fix for you (2 steps left)')
  })
})
