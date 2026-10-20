/**
 * @vitest-environment jsdom
 *
 * Spend down expiring credits (ADR 0028): the status line, the form, and who
 * may change a shared key (ADR 0023).
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SpendDownKeyStatus } from './spendDown'

const KEY: SpendDownKeyStatus = {
  id: 'key-1',
  label: 'ayako',
  keyHint: '…a1b2',
  scope: 'organization',
  status: 'active',
  enabled: false,
  creditsExpireAt: null,
  model: null,
  dailyLimit: 10,
  windowDays: 14,
  state: 'off',
  startsAt: null,
  dispatchedToday: 0,
  remainingToday: 0,
  projects: [],
  lastRunAt: null,
  lastSummary: null,
}

const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  reload: vi.fn(),
  keys: [] as unknown[],
}))
vi.mock('../../lib/supabase', () => ({ apiFetch: mocks.apiFetch }))
vi.mock('../../lib/usePageData', () => ({
  usePageData: () => ({ data: { projectId: 'p', keys: mocks.keys }, loading: false, error: null, reload: mocks.reload }),
}))

import { SpendDownSection } from './SpendDownSection'

const button = (text: string) => {
  const b = Array.from(document.body.querySelectorAll('button')).find((x) => x.textContent?.trim() === text)
  if (!b) throw new Error(`no button "${text}"`)
  return b as HTMLButtonElement
}
function setInput(label: string, value: string) {
  const lab = Array.from(document.body.querySelectorAll('label')).find((l) => l.textContent?.includes(label))
  const input = (lab?.htmlFor ? document.getElementById(lab.htmlFor) : lab?.querySelector('input')) as HTMLInputElement | null
  if (!input) throw new Error(`no input "${label}"`)
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  setter.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('SpendDownSection', () => {
  let container: HTMLDivElement
  let root: Root
  async function render(canManageShared: boolean) {
    await act(async () => root.render(createElement(SpendDownSection, { canManageShared })))
  }
  beforeEach(() => {
    mocks.apiFetch.mockReset()
    mocks.apiFetch.mockResolvedValue({ ok: true, data: {} })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })
  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    document.body.innerHTML = ''
  })

  it('an admin turns it on with a date, a model and a daily limit', async () => {
    mocks.keys = [KEY]
    await render(true)
    expect(document.body.textContent).toContain('Spend-down is off.')
    await act(async () => button('Set up spend-down').click())
    await act(async () => {
      setInput('Credits expire on', '2026-10-31')
      setInput('Model', 'grok-4.7?reasoning_effort=xhigh&context=500k')
      setInput('Fixes per day', '20')
    })
    const box = document.body.querySelector('input[type="checkbox"]') as HTMLInputElement
    await act(async () => box.click())
    await act(async () => button('Save').click())
    const call = mocks.apiFetch.mock.calls.find(([url]) => url === '/v1/admin/byok/keys/key-1/spend-down')!
    expect((call[1] as RequestInit).method).toBe('PATCH')
    expect(JSON.parse(String((call[1] as RequestInit).body))).toEqual({
      enabled: true,
      creditsExpireAt: '2026-10-31',
      model: 'grok-4.7?reasoning_effort=xhigh&context=500k',
      dailyLimit: 20,
      windowDays: 14,
    })
    expect(mocks.reload).toHaveBeenCalled()
    expect(document.body.textContent).toContain('Spend-down saved and on.')
  })

  it('shows what it is doing, and a member cannot change a shared key', async () => {
    mocks.keys = [
      {
        ...KEY,
        enabled: true,
        state: 'active',
        creditsExpireAt: '2026-10-31T23:59:59Z',
        dispatchedToday: 4,
        projects: [{ id: 'p1', name: 'tsumagoi' }],
        lastSummary: { projects: [{ projectId: 'p1', dispatched: 0, stopped: 'No open report to fix' }] },
      },
    ]
    await render(false)
    expect(document.body.textContent).toContain('Spending down: 4 of 10 fixes today')
    expect(document.body.textContent).toContain('tsumagoi: No open report to fix')
    expect(document.body.textContent).toContain('An owner or admin can change it')
    expect(Array.from(document.body.querySelectorAll('button')).some((b) => b.textContent?.includes('spend-down'))).toBe(false)
  })

  it('renders nothing when the app has no Cursor key', async () => {
    mocks.keys = []
    await render(true)
    expect(container.textContent).toBe('')
  })
})
