/**
 * @vitest-environment jsdom
 *
 * "Switch account" (ADR 0048 amendment 2026-10-28): every step says what is
 * happening and what to do next: a CLI too old to switch, waiting for the
 * machine (or it is offline), waiting for its runs, the sign-in link,
 * signed in, the wrong account (Try again), expired, failed; a bad e-mail
 * and a switch already under way are explained, not swallowed.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CursorLoginView, CursorSwitchStatus } from '../../lib/workers'

const state = vi.hoisted(() => ({
  status: null as unknown,
  reads: 0,
  posts: [] as Array<{ hostId: string; account: string; restart: boolean }>,
  postReply: null as unknown,
}))

vi.mock('../../lib/workers', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  readCursorSwitch: async () => {
    state.reads++
    return { ok: true, data: state.status }
  },
  switchCursorAccount: async (hostId: string, account: string, restart = false) => {
    state.posts.push({ hostId, account, restart })
    return state.postReply ?? { ok: true, message: 'Asked.', login: null }
  },
}))

import { SwitchCursorAccountDialog } from './SwitchCursorAccount'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const LINK = 'https://cursor.com/loginDeepControl?challenge=abc&uuid=x&mode=login'
let root: Root
let container: HTMLDivElement

const login = (s: CursorLoginView['state'], extra: Partial<CursorLoginView> = {}): CursorLoginView => ({
  requestId: 'r1',
  state: s,
  account: 'kensaurus@gmail.com',
  requestedAt: '2026-10-28T12:00:00Z',
  at: '2026-10-28T12:00:00Z',
  detail: null,
  ...extra,
})
const status = (extra: Partial<CursorSwitchStatus> = {}): CursorSwitchStatus => ({ account: 'kensaurus@gmail.com', login: null, online: true, canSwitch: true, runs: 0, check: null, ...extra })

async function render(s: CursorSwitchStatus) {
  state.status = s
  await act(async () => {
    root.render(createElement(SwitchCursorAccountDialog, { hostId: 'h1', hostname: 'alienware', onClose: () => {}, pollMs: 60_000 }))
  })
  await act(async () => {})
}

const q = (id: string) => document.querySelector(`[data-testid="${id}"]`)
const text = () => document.querySelector('[data-testid="cursor-switch"]')?.textContent ?? ''

beforeEach(() => {
  state.reads = 0
  state.posts = []
  state.postReply = null
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

async function type(value: string) {
  const input = q('cursor-switch-account') as HTMLInputElement
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
async function submit() {
  await act(async () => {
    ;(q('cursor-switch-form') as HTMLFormElement).dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  })
}

describe('Switch account dialog', () => {
  it('says to update a CLI too old to switch, with the command', async () => {
    await render(status({ canSwitch: false }))
    expect(q('cursor-switch-too-old')).not.toBeNull()
    expect(text()).toContain('npm i -g @mushi-mushi/cli@latest')
    expect(q('cursor-switch-form')).toBeNull()
  })

  it('starts a switch with the prefilled account, and refuses a value that is not an e-mail address', async () => {
    await render(status({ account: 'kensaurus@gmail.com' }))
    expect((q('cursor-switch-account') as HTMLInputElement).value).toBe('kensaurus@gmail.com')
    await type('kensaurus')
    await submit()
    expect(state.posts).toEqual([])
    expect(q('cursor-switch-form-error')!.textContent).toMatch(/e-mail address/)
    await type('new@example.com')
    state.status = status({ login: login('requested', { account: 'new@example.com' }) })
    await submit()
    expect(state.posts).toEqual([{ hostId: 'h1', account: 'new@example.com', restart: false }])
    expect(q('cursor-switch-requested')).not.toBeNull()
  })

  it('says a switch is already under way instead of failing silently', async () => {
    await render(status())
    state.postReply = { ok: false, message: 'A switch is already under way', code: 'IN_PROGRESS' }
    await submit()
    expect(q('cursor-switch-form-error')!.textContent).toMatch(/already under way on this machine. Start again/)
  })

  it('waiting for the machine, or the machine is offline', async () => {
    await render(status({ login: login('requested') }))
    expect(text()).toContain('Waiting for alienware to pick this up')
    act(() => root.unmount())
    root = createRoot(container)
    await render(status({ online: false, login: login('requested') }))
    expect(q('cursor-switch-offline')!.textContent).toMatch(/offline. It starts the switch when it checks in/)
  })

  it('waiting for the runs in flight, with how many', async () => {
    await render(status({ runs: 3, login: login('waiting_for_runs') }))
    expect(q('cursor-switch-runs')!.textContent).toMatch(/Waiting for 3 runs on alienware to finish/)
  })

  it('shows the sign-in link to open in a new tab', async () => {
    await render(status({ login: login('link_ready', { url: LINK }) }))
    const a = q('cursor-switch-open-link') as HTMLAnchorElement
    expect(a.getAttribute('href')).toBe(LINK)
    expect(a.getAttribute('target')).toBe('_blank')
    expect(a.getAttribute('rel')).toContain('noopener')
  })

  it('signed in, wrong account (Try again opens the form), expired and failed each say what happened', async () => {
    await render(status({ login: login('signed_in', { detail: 'Signed in as k***@g***.com.' }) }))
    expect(text()).toContain('Signed in as kensaurus@gmail.com. The lanes take work again.')

    for (const [s, words] of [
      ['wrong_account', 'Signed in as the wrong account'],
      ['expired', 'The switch expired'],
      ['failed', 'did not work'],
    ] as const) {
      act(() => root.unmount())
      root = createRoot(container)
      await render(status({ login: login(s, { detail: 'why it ended' }) }))
      expect(q(`cursor-switch-${s}`)!.textContent).toContain(words)
      expect(text()).toContain('why it ended')
      await act(async () => {
        ;(q('cursor-switch-again') as HTMLButtonElement).click()
      })
      expect(q('cursor-switch-form')).not.toBeNull()
    }
  })

  it('Start again on a switch under way sends restart', async () => {
    await render(status({ login: login('link_ready', { url: LINK }) }))
    await act(async () => {
      ;(q('cursor-switch-restart') as HTMLButtonElement).click()
    })
    await submit()
    expect(state.posts.at(-1)).toMatchObject({ restart: true })
  })
})
