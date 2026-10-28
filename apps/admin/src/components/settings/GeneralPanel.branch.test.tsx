/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/components/settings/GeneralPanel.branch.test.tsx
 * PURPOSE: Report f66ae5d0. Four projects store the old branch pattern
 *          `mushi/fix/{date}-{category}-{shortId}`, which the tightened rule
 *          refuses. The field showed no error and Save stayed disabled, so a
 *          Sentry DSN could not be saved. Now the field says so on load, and
 *          an untouched invalid pattern never blocks saving other fields.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { fixBranchFieldState } from './fixBranchField'

const LEGACY = 'mushi/fix/{date}-{category}-{shortId}'
const DEFAULT = 'bugfix/MUSHI-{reportId}-{category}'

const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  reload: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
  settings: {} as Record<string, unknown>,
}))

vi.mock('../../lib/supabase', () => ({ apiFetch: mocks.apiFetch, apiFetchMutate: mocks.apiFetch }))
vi.mock('../../lib/toast', () => ({ useToast: () => mocks.toast }))
vi.mock('../../lib/usePageData', () => ({
  usePageData: (path: string | null) => ({
    data: path === '/v1/admin/settings' ? mocks.settings : null,
    loading: false,
    error: null,
    reload: mocks.reload,
  }),
}))

import { GeneralPanel } from './GeneralPanel'

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve()
}

function buttonByText(text: string): HTMLButtonElement {
  const btn = Array.from(document.body.querySelectorAll<HTMLButtonElement>('button')).find(
    (b) => b.textContent?.trim() === text,
  )
  if (!btn) throw new Error(`no button "${text}"`)
  return btn
}

function typeInto(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  setter.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

function patchBodies(): Array<Record<string, unknown>> {
  return mocks.apiFetch.mock.calls
    .filter(([path, init]) => path === '/v1/admin/settings' && (init as RequestInit | undefined)?.method === 'PATCH')
    .map(([, init]) => JSON.parse(String((init as RequestInit).body)))
}

describe('fixBranchFieldState', () => {
  it('flags a saved pattern the rule now refuses, without blocking Save', () => {
    const s = fixBranchFieldState({ current: LEGACY, saved: LEGACY, defaultValue: DEFAULT })
    expect(s.blocksSave).toBe(false)
    expect(s.error).toContain(`fixes use ${DEFAULT}`)
  })

  it('blocks Save only when the user edits the pattern into a refused one', () => {
    expect(fixBranchFieldState({ current: 'oops/{shortId}', saved: DEFAULT, defaultValue: DEFAULT }).blocksSave).toBe(true)
    expect(fixBranchFieldState({ current: DEFAULT, saved: LEGACY, defaultValue: DEFAULT })).toEqual({ error: null, blocksSave: false })
    expect(fixBranchFieldState({ current: null, saved: null, defaultValue: DEFAULT })).toEqual({ error: null, blocksSave: false })
  })
})

describe('GeneralPanel with a legacy branch pattern', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    mocks.settings = { fix_branch_template: LEGACY, slack_channel_id: 'C123' }
    mocks.apiFetch.mockReset()
    mocks.apiFetch.mockResolvedValue({ ok: true, data: {} })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  async function render(): Promise<void> {
    await act(async () => {
      root.render(createElement(MemoryRouter, null, createElement(GeneralPanel)))
      await flush()
    })
  }

  it('marks the branch field invalid on load, with the message under it', async () => {
    await render()
    const branch = Array.from(container.querySelectorAll<HTMLInputElement>('input')).find((i) => i.value === LEGACY)!
    expect(branch.getAttribute('aria-invalid')).toBe('true')
    expect(container.textContent).toContain('Your saved pattern is no longer allowed')
  })

  // Empty fields showed "C0B82A322RW" and a full-looking DSN beside "Not
  // connected", reading as real values (integrator's walk, 2026-10-28).
  it('shows example placeholders that read as examples', async () => {
    await render()
    const placeholderOf = (label: string) =>
      Array.from(container.querySelectorAll('label'))
        .find((l) => l.textContent?.trim().startsWith(label))
        ?.querySelector('input')?.placeholder ?? ''
    for (const label of ['Channel ID', 'Sentry DSN', 'Supabase project ref']) {
      expect(placeholderOf(label).startsWith('e.g. '), label).toBe(true)
    }
  })

  it('saves a new Sentry DSN without touching the branch pattern', async () => {
    await render()
    const dsn = container.querySelector<HTMLInputElement>('input[placeholder*="ingest.sentry.io"]')!
    await act(async () => {
      typeInto(dsn, 'https://abc123@o0.ingest.sentry.io/1')
      await flush()
    })
    const save = buttonByText('Save changes')
    expect(save.disabled).toBe(false)
    await act(async () => {
      save.click()
      await flush()
    })
    expect(patchBodies()).toEqual([{ sentry_dsn: 'https://abc123@o0.ingest.sentry.io/1' }])
  })

  it('still blocks Save when the user types a refused pattern', async () => {
    mocks.settings = { fix_branch_template: DEFAULT }
    await render()
    const branch = Array.from(container.querySelectorAll<HTMLInputElement>('input')).find((i) => i.value === DEFAULT)!
    await act(async () => {
      typeInto(branch, 'oops/{shortId}')
      await flush()
    })
    expect(buttonByText('Save changes').disabled).toBe(true)
  })

  // The four model pickers were about 340 of the tab's ~2,600 words
  // (integrator's new-user walk, 2026-10-28). One row stands in for them.
  it('keeps the four model pickers behind one row until asked', async () => {
    localStorage.clear()
    await render()
    const headings = () => Array.from(container.querySelectorAll('h3')).map((h) => h.textContent?.trim())
    expect(headings()).toContain('AI models')
    expect(headings()).not.toContain('Triage model')
    await act(async () => {
      buttonByText('Change models').click()
      await flush()
    })
    expect(headings()).toEqual(expect.arrayContaining(['Triage model', 'Quick check model', 'Judge model', 'Fix model']))
  })
})
