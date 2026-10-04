/**
 * @vitest-environment jsdom
 */

/**
 * Dashboard controls do what they say (console repair group H, 2026-10-04):
 *   QA 286  "Send another" stayed disabled and the chip promised a
 *           navigation that never happened.
 *   QA 173  the LLM sparklines offered drag-to-filter into /reports, which
 *           ignores from/to.
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
import { ChartsRow } from './ChartsRow'

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

describe('ChartsRow', () => {
  const days = Array.from({ length: 3 }, (_, i) => `2026-10-0${i + 1}`)
  const props = {
    reportsByDay: days.map((day) => ({ day, total: 1, critical: 0, high: 0, medium: 1, low: 0, unscored: 0 })),
    llmByDay: days.map((day) => ({ day, calls: 2, tokens: 100, latencyMs: 10, failures: 0 })),
  }

  it('does not offer a date filter that Reports would drop', async () => {
    await act(async () => {
      root.render(createElement(MemoryRouter, null, createElement(ChartsRow, props)))
      await flush()
    })
    expect(container.innerHTML).not.toContain('drag to filter')
    expect(container.textContent).not.toContain('newest 5,000')
  })

  it('says when the charts are drawn from the newest rows only', async () => {
    await act(async () => {
      root.render(createElement(MemoryRouter, null, createElement(ChartsRow, { ...props, sampled: true })))
      await flush()
    })
    expect(container.textContent).toContain('newest 5,000 rows')
  })
})
