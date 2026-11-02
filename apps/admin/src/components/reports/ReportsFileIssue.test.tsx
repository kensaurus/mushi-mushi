/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/components/reports/ReportsFileIssue.test.tsx
 * PURPOSE: "Report an issue" files the owner's own report for the app the way a
 *          user would: the kind of issue, a title and what happened are sent to
 *          POST /v1/admin/projects/:id/reports, a fix lane of this app can take
 *          it first, and a refusal is shown in the server's words.
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const calls: Array<{ path: string; body: unknown }> = []
const state = vi.hoisted(() => ({ reply: { ok: true, data: { reportId: 'r-new' } } as unknown, lanes: [] as unknown[], hosts: [] as unknown[] }))
vi.mock('../../lib/supabase', () => ({
  apiFetch: async (path: string, init?: { body?: string }) => {
    calls.push({ path, body: init?.body ? JSON.parse(init.body) : null })
    return state.reply
  },
}))
vi.mock('../../lib/usePageData', () => ({
  usePageData: () => ({ data: { lanes: state.lanes, hosts: state.hosts, projects: [], generatedAt: '' }, loading: false, error: null, reload: vi.fn() }),
}))

import { ReportsFileIssue } from './ReportsFileIssue'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root
const onFiled = vi.fn()

function render() {
  act(() => {
    root.render(createElement(MemoryRouter, null, createElement(ReportsFileIssue, { projectId: 'p1', projectName: 'yen-yen', onClose: () => {}, onFiled })))
  })
}

function type(label: string, value: string) {
  const field = [...container.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input, textarea, select')].find(
    (el) => el.labels?.[0]?.textContent?.includes(label),
  )!
  const proto = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : field instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype
  act(() => {
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(field, value)
    field.dispatchEvent(new Event(field instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
  })
}

async function send() {
  await act(async () => {
    container.querySelector<HTMLButtonElement>('[data-testid="mushi-reports-file-issue-send"]')!.click()
  })
}

beforeEach(() => {
  calls.length = 0
  onFiled.mockClear()
  state.reply = { ok: true, data: { reportId: 'r-new' } }
  state.lanes = []
  state.hosts = []
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('ReportsFileIssue', () => {
  it('sends the kind, title, details and screen, then links to the new report', async () => {
    render()
    expect(container.querySelector<HTMLButtonElement>('[data-testid="mushi-reports-file-issue-send"]')!.disabled).toBe(true)
    type('What kind of issue', 'slow')
    type('In one line', 'The Account page takes 5 seconds to open')
    type('What happened', 'Tap Account. Blank for 5 s, then the list.')
    type('Where', 'Account')
    await send()
    expect(calls[0]).toEqual({
      path: '/v1/admin/projects/p1/reports',
      body: { title: 'The Account page takes 5 seconds to open', description: 'Tap Account. Blank for 5 s, then the list.', category: 'slow', component: 'Account' },
    })
    expect(onFiled).toHaveBeenCalled()
    expect(container.querySelector('a[href="/reports/r-new"]')).not.toBeNull()
  })

  it("offers this app's fix lanes; files straight onto a lane on your own machine", async () => {
    state.hosts = [
      { id: 'h-mine', mine: true },
      { id: 'h-teammate', mine: false },
    ]
    state.lanes = [
      { id: 'lane-fix', hostId: 'h-mine', projectId: 'p1', name: 'yenyen', config: { mode: 'fix' } },
      { id: 'lane-fu', hostId: 'h-mine', projectId: 'p1', name: 'yenyen-fu', config: { mode: 'followups' } },
      { id: 'lane-other', hostId: 'h-mine', projectId: 'p2', name: 'glot', config: { mode: 'fix' } },
      { id: 'lane-teammate', hostId: 'h-teammate', projectId: 'p1', name: 'yenyen-2', config: { mode: 'fix' } },
    ]
    render()
    const options = [...container.querySelectorAll('option')].map((o) => o.getAttribute('value'))
    expect(options).toContain('lane-fix')
    expect(options).toContain('lane-teammate')
    expect(options).not.toContain('lane-fu')
    expect(options).not.toContain('lane-other')
    type('In one line', 'Undo for a mistaken change')
    type('What happened', 'After a transfer, show a toast with Undo for a few seconds.')
    type('Fix it on', 'lane-fix')
    await send()
    expect(calls).toHaveLength(1)
    expect(calls[0].body).toMatchObject({ category: 'bug', queue: { laneId: 'lane-fix' } })
  })

  it("puts the report on a teammate's lane through the lane queue, since filing may only queue on your own machine", async () => {
    state.hosts = [{ id: 'h-teammate', mine: false }]
    state.lanes = [{ id: 'lane-teammate', hostId: 'h-teammate', projectId: 'p1', name: 'yenyen', config: { mode: 'fix' } }]
    render()
    type('In one line', 'Account page is slow')
    type('What happened', 'Five seconds to open.')
    type('Fix it on', 'lane-teammate')
    await send()
    expect(calls[0].body).not.toHaveProperty('queue')
    expect(calls[1]).toEqual({ path: '/v1/admin/work/lanes/lane-teammate/queue', body: { reportIds: ['r-new'], append: true } })
    expect(container.querySelector('[role="alert"]')).toBeNull()
  })

  it("shows the server's reason when the report is refused", async () => {
    state.reply = { ok: false, error: { code: 'RATE_LIMITED', message: 'This app already had 30 reports filed in the last hour. Try again later.' } }
    render()
    type('In one line', 'Something broke')
    type('What happened', 'It broke.')
    await send()
    expect(container.querySelector('[role="alert"]')!.textContent).toBe('This app already had 30 reports filed in the last hour. Try again later.')
    expect(onFiled).not.toHaveBeenCalled()
  })
})
