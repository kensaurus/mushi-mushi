/**
 * @vitest-environment jsdom
 *
 * Settings → CI policy (ADR 0037): nothing is filled in for you; the form
 * imports your CI agreement line by line and PUTs it; bad lines block Save;
 * an admin cannot turn the no-spend rule off (only an owner); members read
 * it; before the database update nothing can be saved.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CiPolicyResponse } from '../../lib/ciPlacementTypes'
import { ORG, policyFixture } from '../ci/__fixtures__/ciPlacement'

const state = vi.hoisted(() => ({ data: null as unknown, paths: [] as Array<string | null>, reload: vi.fn(), apiFetch: vi.fn() }))

vi.mock('../../lib/supabase', () => ({ apiFetch: state.apiFetch }))
vi.mock('../../lib/usePageData', () => ({
  usePageData: (path: string | null) => {
    state.paths.push(path)
    return { data: state.data, loading: false, error: null, errorCode: null, errorMessage: null, isValidating: false, lastFetchedAt: 't1', reload: state.reload }
  },
}))

import { CiPolicyCard } from './CiPolicyCard'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const response = (over: Partial<CiPolicyResponse> = {}): CiPolicyResponse => ({ organizationId: ORG, policy: null, writable: true, canEdit: true, canLift: true, ...over })

let root: Root
let host: HTMLDivElement

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  state.data = response()
  state.paths = []
  state.reload.mockReset()
  state.apiFetch.mockReset()
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

async function render() {
  await act(async () => {
    root.render(createElement(MemoryRouter, null, createElement(CiPolicyCard, { projectId: 'p1' })))
  })
}

function field(text: string): HTMLInputElement | HTMLTextAreaElement {
  const label = Array.from(host.querySelectorAll('label')).find((l) => l.textContent?.trim().startsWith(text))
  const el = label?.querySelector('input, textarea') ?? (label?.htmlFor ? host.querySelector(`#${CSS.escape(label.htmlFor)}`) : null)
  if (!el) throw new Error(`no field ${text}`)
  return el as HTMLInputElement
}
async function set(text: string, value: string) {
  const el = field(text)
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
const toggle = () => host.querySelector('[role="switch"]') as HTMLButtonElement
const button = (text: string) => Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.trim() === text)
async function click(el: HTMLElement | undefined) {
  if (!el) throw new Error('nothing to click')
  await act(async () => {
    el.click()
  })
}

describe('CiPolicyCard', () => {
  it('starts empty and imports the agreement', async () => {
    state.apiFetch.mockResolvedValue({ ok: true, data: response({ policy: policyFixture() }) })
    await render()
    expect(state.paths[0]).toBe('/v1/admin/ci/policy?project_id=p1')
    expect(host.textContent).toContain('Nothing recorded yet')
    expect(toggle().getAttribute('aria-checked')).toBe('false')
    await click(toggle())
    await set('Repos allowed on GitHub-hosted anyway', 'AtPeak-Co-Ltd/pck\nkensaurus/mushi-mushi')
    await set('One per line: name | owner', 'kci dispatcher | sbc-visual | kensaurus/solo-boss-cloud_backend, kensaurus/tsumagoi')
    await set('One runner name or label per line', 'kensaurus-local-*')
    await set('Source', 'CI-AGREEMENT.md, 2026-10-22')
    await click(button('Save changes'))
    const [path, init] = state.apiFetch.mock.calls[0]!
    expect(path).toBe('/v1/admin/ci/policy')
    expect((init as RequestInit).method).toBe('PUT')
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      organizationId: ORG,
      noPaidHostedOnPrivate: true,
      hostedAllowedRepos: ['AtPeak-Co-Ltd/pck', 'kensaurus/mushi-mushi'],
      externalControllers: [{ name: 'kci dispatcher', owner: 'sbc-visual', repos: ['kensaurus/solo-boss-cloud_backend', 'kensaurus/tsumagoi'], note: null }],
      standbyRunners: ['kensaurus-local-*'],
      sourceNote: 'CI-AGREEMENT.md, 2026-10-22',
    })
    expect(host.textContent).toContain('Saved.')
  })

  it('bad lines block Save', async () => {
    await render()
    await set('One per line: name | owner', 'just a name')
    expect(host.textContent).toContain('Line 1')
    expect(host.textContent).toContain('Fix the fields marked above first.')
    await click(button('Save changes'))
    expect(state.apiFetch).not.toHaveBeenCalled()
  })

  it('an admin cannot turn the no-spend rule off', async () => {
    state.data = response({ policy: policyFixture(), canLift: false })
    await render()
    expect(toggle().getAttribute('aria-checked')).toBe('true')
    expect(toggle().disabled).toBe(true)
  })

  it('members read it; before the database update nothing saves', async () => {
    state.data = response({ policy: policyFixture(), canEdit: false, canLift: false })
    await render()
    expect(host.querySelector('[data-testid="ci-policy-readonly"]')).not.toBeNull()
    expect(button('Save changes')).toBeUndefined()
    state.data = response({ writable: false, canEdit: false, canLift: false })
    await render()
    expect(host.querySelector('[data-testid="ci-policy-not-writable"]')).not.toBeNull()
    expect((field('Source') as HTMLInputElement).disabled).toBe(true)
  })
})
