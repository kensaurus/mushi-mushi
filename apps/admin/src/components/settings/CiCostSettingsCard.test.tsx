/**
 * @vitest-environment jsdom
 *
 * Settings → CI cost (ADR 0037): example figures until saved; picking a plan
 * fills its included minutes; a save PUTs every figure for the active app's
 * organization (machines parsed from the text, with their own watts); bad
 * figures are explained and block Save; a refused save shows the server's
 * message; viewers and a database without the table see it read-only.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CiCostSettingsResponse } from '../../lib/ciCompareTypes'
import { costSettingsFixture, ORG_ID } from '../ci/__fixtures__/ciCompare'

const state = vi.hoisted(() => ({ data: null as unknown, paths: [] as Array<string | null>, reload: vi.fn(), apiFetch: vi.fn() }))

vi.mock('../../lib/supabase', () => ({ apiFetch: state.apiFetch }))
vi.mock('../../lib/usePageData', () => ({
  usePageData: (path: string | null) => {
    state.paths.push(path)
    return { data: state.data, loading: false, error: null, errorCode: null, errorMessage: null, isValidating: false, lastFetchedAt: 't1', reload: state.reload }
  },
}))

import { CiCostSettingsCard } from './CiCostSettingsCard'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const BOUNDS: CiCostSettingsResponse['bounds'] = {
  watts: { min: 0, max: 5000 },
  pricePerKwh: { min: 0, max: 1000 },
  wearPerHour: { min: 0, max: 10000 },
  fxPerUsd: { min: 0.0001, max: 100000 },
  includedMinutes: { min: 0, max: 1000000 },
  selfHostedFeePerMinuteUsd: { min: 0, max: 1 },
  machines: 20,
  machineRunners: 20,
}

function response(over: Partial<CiCostSettingsResponse> = {}): CiCostSettingsResponse {
  return { settings: costSettingsFixture(), writable: true, canEdit: true, bounds: BOUNDS, plans: ['free', 'pro', 'team', 'enterprise', 'custom'], ...over }
}

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

async function render(projectId: string | null = 'p1') {
  await act(async () => {
    root.render(createElement(MemoryRouter, null, createElement(CiCostSettingsCard, { projectId })))
  })
}

/** The input, select or textarea inside the label that starts with `text`. */
function field(text: string): HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement {
  const label = Array.from(host.querySelectorAll('label')).find((l) => l.textContent?.trim().startsWith(text))
  const el = label?.querySelector('input, select, textarea') ?? (label?.htmlFor ? host.querySelector(`#${CSS.escape(label.htmlFor)}`) : null)
  if (!el) throw new Error(`no field labelled ${text}`)
  return el as HTMLInputElement
}

async function set(text: string, value: string) {
  const el = field(text)
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value)
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
  })
}

const button = (text: string) => Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.trim() === text)
async function click(el: HTMLElement | undefined) {
  if (!el) throw new Error('nothing to click')
  await act(async () => {
    el.click()
  })
}

describe('CiCostSettingsCard', () => {
  it('reads the active app’s organization and shows the example figures', async () => {
    await render()
    expect(state.paths[0]).toBe('/v1/admin/ci/cost-settings?project_id=p1')
    expect((field('Draw under load') as HTMLInputElement).value).toBe('180')
    expect((field('Included minutes') as HTMLInputElement).disabled).toBe(true)
    expect(button('Save changes')).toBeUndefined()
  })

  it('fills included minutes from the plan, and saves every figure with machines parsed', async () => {
    state.apiFetch.mockResolvedValue({ ok: true, data: response({ settings: costSettingsFixture({ source: 'yours', plan: 'pro', includedMinutes: 3000 }) }) })
    await render()
    await set('Plan', 'pro')
    expect((field('Included minutes') as HTMLInputElement).value).toBe('3000')
    await set('Currency', 'jpy')
    await set('JPY per US dollar', '150')
    await set('Price per kWh', '31')
    await set('One machine per line', 'Alienware (40-250 W): aw-, alienware-\nNUC: kensaurus-local-')
    await click(button('Save changes'))
    const [path, init] = state.apiFetch.mock.calls[0]!
    expect(path).toBe('/v1/admin/ci/cost-settings')
    expect((init as RequestInit).method).toBe('PUT')
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      organizationId: ORG_ID,
      currency: 'JPY',
      fxPerUsd: 150,
      wattsIdle: 30,
      wattsLoad: 180,
      pricePerKwh: 31,
      wearPerHour: 0,
      plan: 'pro',
      includedMinutes: 3000,
      selfHostedFeePerMinuteUsd: 0,
      machines: [
        { name: 'Alienware', runners: ['aw-', 'alienware-'], wattsIdle: 40, wattsLoad: 250 },
        { name: 'NUC', runners: ['kensaurus-local-'] },
      ],
    })
    expect(state.reload).toHaveBeenCalled()
    expect(host.textContent).toContain('Saved.')
  })

  it('explains bad figures and blocks Save', async () => {
    await render()
    await set('Idle draw', '300')
    expect(host.textContent).toContain('At least the idle draw.')
    await set('One machine per line', 'no colon here')
    expect(host.textContent).toContain('Line 1')
    expect(host.textContent).toContain('Fix the fields marked above first.')
    await click(button('Save changes'))
    expect(state.apiFetch).not.toHaveBeenCalled()
  })

  it('shows the server’s message when the save is refused', async () => {
    state.apiFetch.mockResolvedValue({ ok: false, error: { code: 'FORBIDDEN', message: 'Viewers have read-only access.' } })
    await render()
    await set('Price per kWh', '0.3')
    await click(button('Save changes'))
    expect(host.textContent).toContain('Viewers have read-only access.')
  })

  it('is read-only for viewers and API keys', async () => {
    state.data = response({ canEdit: false })
    await render()
    expect(host.querySelector('[data-testid="ci-cost-readonly"]')).not.toBeNull()
    expect((field('Draw under load') as HTMLInputElement).disabled).toBe(true)
    expect(host.textContent).not.toContain('Save changes')
  })

  it('says it cannot save before the database update, with every field disabled', async () => {
    state.data = response({ writable: false, canEdit: false })
    await render(null)
    expect(state.paths[0]).toBe('/v1/admin/ci/cost-settings')
    expect(host.querySelector('[data-testid="ci-cost-not-writable"]')!.textContent).toContain('example figures')
    expect((field('Plan') as HTMLSelectElement).disabled).toBe(true)
  })
})
