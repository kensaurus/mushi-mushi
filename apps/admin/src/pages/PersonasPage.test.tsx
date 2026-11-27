/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/pages/PersonasPage.test.tsx
 * PURPOSE: /personas, the persona studio (ADR 0075, Plan 025 P3):
 *   - loading and a failed read (with Retry) each say so;
 *   - an app with no personas leads with the presets, and Add posts { preset };
 *   - each persona card shows who it is, its sparkline of time to first value,
 *     how its last test went, and a link that starts a test as it;
 *   - Delete asks first and says past tests keep it;
 *   - a viewer sees the personas but no Add, Edit or Delete;
 *   - test-account controls show only to someone who can change them, and a
 *     new signing secret is shown once.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const P = '1000000f-0000-4000-8000-000000000000'
const PATH = `/v1/admin/projects/${P}/personas`
const mocks = vi.hoisted(() => ({
  page: null as unknown,
  reload: vi.fn(),
  calls: [] as Array<{ path: string; method: string; body: unknown }>,
  reply: null as unknown,
}))
vi.mock('../lib/usePageData', () => ({ usePageData: (path: string | null) => (path === PATH ? mocks.page : { data: null, loading: false, error: null, reload: vi.fn() }) }))
vi.mock('../lib/realtime', () => ({ useRealtimeReload: () => ({ channelState: 'idle' }) }))
vi.mock('../lib/supabase', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  apiFetchMutate: async (path: string, opts: { method?: string; body?: string } = {}) => {
    mocks.calls.push({ path, method: opts.method ?? 'POST', body: opts.body ? JSON.parse(opts.body) : null })
    return mocks.reply ?? { ok: true, data: {} }
  },
}))
vi.mock('../components/ProjectSwitcher', () => ({ useActiveProjectId: () => P }))
vi.mock('../components/PageHeaderBar', () => ({ PageHeaderBar: ({ title }: { title: string }) => createElement('h1', null, title) }))

import { PersonasPage } from './PersonasPage'
import type { Persona, PersonaPreset, PersonaRun, PersonasData } from '../lib/personas'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const PRESETS: PersonaPreset[] = [
  {
    id: 'first_time',
    blurb: 'Has never heard of the app and arrives from a link.',
    name: 'First-time visitor',
    preset: 'first_time',
    goal: null,
    locale: 'en-US',
    device: 'desktop',
    expertise: 'new',
    accessibility: [],
    patienceSteps: 30,
    costCapUsd: 1,
    notes: null,
    brief: 'You are "First-time visitor".',
  },
  {
    id: 'japanese_user',
    blurb: 'Reads Japanese on a phone; English-only screens slow them down.',
    name: 'Japanese visitor',
    preset: 'japanese_user',
    goal: null,
    locale: 'ja-JP',
    device: 'mobile',
    expertise: 'casual',
    accessibility: [],
    patienceSteps: 30,
    costCapUsd: 1,
    notes: null,
    brief: 'You are "Japanese visitor".',
  },
]

const run = (over: Partial<PersonaRun>): PersonaRun => ({
  local_run_id: '20261120-090000-ab12',
  persona_id: 'p',
  status: 'done',
  started_at: '2026-11-20T09:00:00Z',
  finished_at: '2026-11-20T09:20:00Z',
  ttfv_seconds: 41,
  reached: 2,
  steps: 9,
  dry_run: false,
  counts: { sessions: 3 },
  ...over,
})

const JA: Persona = {
  id: '2000000f-0000-4000-8000-000000000001',
  name: 'Japanese visitor',
  preset: 'japanese_user',
  goal: 'find a lesson and start it',
  locale: 'ja-JP',
  device: 'mobile',
  expertise: 'casual',
  accessibility: ['reduced_motion'],
  patienceSteps: 30,
  costCapUsd: 1,
  notes: null,
  brief: 'You are "Japanese visitor". You use a few apps like this now and then.',
  plays: { id: '2000000f-0000-4000-8000-000000000001', name: 'Japanese visitor', brief: '', locale: 'ja-JP', device: 'mobile', needs: ['reduced_motion'], steps: 30 },
  createdAt: '2026-11-01T00:00:00Z',
  updatedAt: '2026-11-01T00:00:00Z',
  // Newest first: the sparkline draws them oldest first.
  runs: [run({ ttfv_seconds: 41 }), run({ local_run_id: '20261110-090000-cd34', started_at: '2026-11-10T09:00:00Z', ttfv_seconds: 95 })],
}

const DATA = (over: Partial<PersonasData> = {}): PersonasData => ({
  personas: [JA],
  presets: PRESETS,
  limit: 24,
  canEdit: true,
  testAccounts: { mode: 'off', hookUrl: null, hasSecret: false, canChange: true, canUseMushi: false },
  budget: { monthlyUsd: 20, spentUsd: 3.5, heldUsd: 1, resetsAt: '2026-12-01T00:00:00Z' },
  ...over,
})

const ready = (data: PersonasData) => ({ data, loading: false, error: null, errorCode: null, requestId: null, reload: mocks.reload })

let host: HTMLDivElement
let root: Root
beforeEach(() => {
  mocks.page = ready(DATA())
  mocks.reload.mockReset()
  mocks.calls = []
  mocks.reply = null
  Element.prototype.scrollIntoView ??= () => {}
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

function render() {
  act(() => root.render(createElement(MemoryRouter, { initialEntries: ['/personas'] }, createElement(PersonasPage))))
}

const buttons = () => [...host.querySelectorAll('button')]
const byText = (text: string) => buttons().find((b) => b.textContent?.trim() === text)
const byLabel = (label: string) => host.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement | null

describe('the studio loads', () => {
  it('says it is loading', () => {
    mocks.page = { data: null, loading: true, error: null, reload: mocks.reload }
    render()
    expect(host.textContent).toContain('Loading personas…')
    expect(host.querySelector('[data-testid="persona-card"]')).toBeNull()
  })

  it('says a failed read failed, with Retry', () => {
    mocks.page = { data: null, loading: false, error: 'Internal error (INTERNAL_ERROR)', errorCode: 'INTERNAL_ERROR', requestId: null, reload: mocks.reload }
    render()
    expect(host.textContent).toContain("Couldn't load personas")
    act(() => byText('Retry')!.click())
    expect(mocks.reload).toHaveBeenCalledTimes(1)
  })
})

describe('an app with no personas', () => {
  it('leads with the presets, and Add posts the preset', async () => {
    mocks.page = ready(DATA({ personas: [] }))
    render()
    expect(host.querySelector('#persona-presets')!.textContent).toBe('Start from a preset')
    expect(host.querySelectorAll('[data-testid="persona-preset"]')).toHaveLength(2)
    expect(host.querySelector('[data-testid="persona-card"]')).toBeNull()
    expect(host.querySelector('[data-testid="personas-status"]')!.textContent).toContain('No personas yet')
    mocks.reply = { ok: true, data: { persona: { ...JA, runs: [] } } }
    await act(async () => byLabel('Add Japanese visitor')!.click())
    expect(mocks.calls).toEqual([{ path: PATH, method: 'POST', body: { preset: 'japanese_user' } }])
    expect(host.textContent).toContain('Added Japanese visitor.')
    expect(mocks.reload).toHaveBeenCalled()
  })

  it("shows a failed Add in the server's words", async () => {
    mocks.page = ready(DATA({ personas: [] }))
    mocks.reply = { ok: false, error: { code: 'NAME_TAKEN', message: 'This app already has a persona called "Japanese visitor". Pick another name.' } }
    render()
    await act(async () => byLabel('Add Japanese visitor')!.click())
    expect(host.querySelector('[role="alert"]')!.textContent).toContain('Pick another name.')
  })
})

describe('a persona card', () => {
  it('shows who it is, its sparkline and its last result, and starts a test as it', () => {
    render()
    const card = host.querySelector('[data-testid="persona-card"]')!
    expect(card.querySelector('h3')!.textContent).toBe('Japanese visitor')
    expect(card.querySelector('[data-testid="persona-avatar"]')!.getAttribute('aria-label')).toBe('Japanese visitor: phone, reads Japanese, reduced motion')
    expect(card.textContent).toContain('Gives up after ~30 steps · $1 a test')
    const history = card.querySelector('[data-testid="persona-history"]')!
    expect(history.textContent).toContain('Reached the goal 2 of 3 · 41 s to first value')
    expect(history.querySelector('svg[role="img"]')!.getAttribute('aria-label')).toBe('Time to first value over 2 tests, latest 41 s')
    expect(card.querySelector(`a[href="/first-user-test?persona=${JA.id}"]`)!.textContent).toBe('Test with this persona')
    // The status block: how many, and the month's budget.
    expect(host.querySelector('[data-testid="personas-budget"]')!.textContent).toBe('This month: $3.50 of $20 · $1 held by running tests')
    // Presets not used yet are still offered.
    expect([...host.querySelectorAll('[data-testid="persona-preset"] h3')].map((h) => h.textContent)).toEqual(['First-time visitor'])
  })

  it('says when a persona has not been tested', () => {
    mocks.page = ready(DATA({ personas: [{ ...JA, runs: [] }], budget: null }))
    render()
    const history = host.querySelector('[data-testid="persona-history"]')!
    expect(history.textContent).toContain('No tests yet')
    expect(history.querySelector('svg[role="img"]')).toBeNull()
    expect(host.querySelector('[data-testid="personas-budget"]')!.textContent).toContain('Budget unknown')
  })

  it('opens the editor on Edit', () => {
    render()
    act(() => byLabel('Edit Japanese visitor')!.click())
    expect(host.querySelector('[data-testid="persona-editor"] h2')!.textContent).toBe('Edit Japanese visitor')
  })

  it('asks before Delete, says past tests keep it, then archives it', async () => {
    render()
    act(() => byLabel('Delete Japanese visitor')!.click())
    expect(document.body.textContent).toContain('Past tests keep it')
    mocks.reply = { ok: true, data: { id: JA.id, archived: true } }
    await act(async () => (document.body.querySelector('button[data-primary]') as HTMLButtonElement).click())
    expect(mocks.calls).toEqual([{ path: `${PATH}/${JA.id}`, method: 'DELETE', body: null }])
    expect(host.textContent).toContain('Deleted Japanese visitor. Its past tests keep it.')
  })
})

describe('a viewer', () => {
  it('sees the personas but cannot add, edit or delete', () => {
    mocks.page = ready(DATA({ canEdit: false, testAccounts: { mode: 'hook', hookUrl: 'https://app.example/hook', hasSecret: true, canChange: false, canUseMushi: false } }))
    render()
    expect(host.querySelectorAll('[data-testid="persona-card"]')).toHaveLength(1)
    expect(byLabel('Edit Japanese visitor')).toBeNull()
    expect(byLabel('Delete Japanese visitor')).toBeNull()
    expect(byText('New persona')).toBeUndefined()
    expect(host.querySelector('[data-testid="persona-preset"]')).toBeNull()
    expect(host.textContent).toContain('Viewers cannot add, change or delete them.')
    // Still allowed: testing with a persona.
    expect(host.querySelector(`a[href="/first-user-test?persona=${JA.id}"]`)).not.toBeNull()
  })
})

describe('test accounts', () => {
  it('shows the setting but no controls to someone who cannot change it', () => {
    mocks.page = ready(DATA({ testAccounts: { mode: 'hook', hookUrl: 'https://app.example/hook', hasSecret: true, canChange: false, canUseMushi: false } }))
    render()
    const card = host.querySelector('[data-testid="test-accounts"]')!
    expect(card.querySelector('[role="radiogroup"]')).toBeNull()
    expect([...card.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Save')).toBeUndefined()
    expect(card.textContent).toContain("Now: Your app's test-account hook (https://app.example/hook). Only an owner or admin of this app can change it.")
    // The hook contract is still there to read.
    expect(card.textContent).toContain('How the hook works')
  })

  it("offers Mushi's own sign-in only to an operator", () => {
    render()
    const labels = () => [...host.querySelectorAll('[data-testid="test-accounts"] [role="radio"]')].map((r) => r.textContent)
    expect(labels()).toEqual(['Off', "Your app's test-account hook"])
    mocks.page = ready(DATA({ testAccounts: { mode: 'off', hookUrl: null, hasSecret: false, canChange: true, canUseMushi: true } }))
    render()
    expect(labels()).toContain("This Mushi's own sign-in (operators)")
  })

  it('turns the hook on and shows the signing secret once', async () => {
    render()
    const card = () => host.querySelector('[data-testid="test-accounts"]')!
    act(() => ([...card().querySelectorAll('[role="radio"]')].find((r) => r.textContent === "Your app's test-account hook") as HTMLButtonElement).click())
    const url = card().querySelector('input[type="url"]') as HTMLInputElement
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(url, 'https://app.example/hook')
      url.dispatchEvent(new Event('input', { bubbles: true }))
    })
    mocks.reply = { ok: true, data: { mode: 'hook', hookUrl: 'https://app.example/hook', hasSecret: true, secret: 'mtah_0123456789abcdef' } } // gitleaks:allow — fake hook signing secret for the one-time reveal test
    await act(async () => ([...card().querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Save') as HTMLButtonElement).click())
    expect(mocks.calls).toEqual([{ path: `/v1/admin/projects/${P}/test-accounts`, method: 'PUT', body: { mode: 'hook', hookUrl: 'https://app.example/hook' } }])
    expect(card().textContent).toContain('mtah_0123456789abcdef')
    expect(card().textContent).toContain('You won’t see it again')
    act(() => ([...card().querySelectorAll('button')].find((b) => b.textContent?.trim() === 'I copied it') as HTMLButtonElement).click())
    expect(card().textContent).not.toContain('mtah_0123456789abcdef')
  })
})
