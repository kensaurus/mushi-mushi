/**
 * @vitest-environment jsdom
 */

/**
 * Dashboard controls do what they say (console repair group H, 2026-10-04):
 *   QA 286  "Send another" stayed disabled and the chip promised a
 *           navigation that never happened.
 *   QA 174  the backlog tile said "open > 1h" while opening every report in
 *           the new bucket.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const send = vi.hoisted(() => ({ fn: vi.fn() }))
vi.mock('../../lib/useSendTestReport', () => ({ useSendTestReport: () => send.fn }))

import { FirstReportHero } from './FirstReportHero'

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve()
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function button(text: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll('button')).find((b) => (b.textContent ?? '').trim() === text)
}

describe('FirstReportHero', () => {
  it('keeps "Send another" clickable and does not promise a navigation', async () => {
    send.fn.mockResolvedValue({ ok: true })
    await act(async () => {
      root.render(
        createElement(MemoryRouter, null, createElement(FirstReportHero, { projectId: 'p1', projectName: 'glot.it' })),
      )
      await flush()
    })
    await act(async () => {
      button('Send test report')?.click()
      await flush()
    })
    const again = button('Send another')
    expect(again).toBeDefined()
    expect(again?.disabled).toBe(false)
    expect(container.textContent).not.toContain('opening /reports')
    expect(container.textContent).toContain('It shows in Reports')

    await act(async () => {
      again?.click()
      await flush()
    })
    expect(send.fn).toHaveBeenCalledTimes(2)
  })
})
