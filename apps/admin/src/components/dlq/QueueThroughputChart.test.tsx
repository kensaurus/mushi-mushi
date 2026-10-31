/**
 * @vitest-environment jsdom
 *
 * The 14-day range splits on a date hyphen at 390px ("2026-10-" / "26")
 * unless the range is one unbreakable flex item and the header can wrap.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { QueueThroughputChart } from './QueueThroughputChart'
import type { ThroughputDay } from './types'

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

const throughput: ThroughputDay[] = [
  { day: '2026-10-13', created: 2, completed: 1, failed: 0 },
  { day: '2026-10-26', created: 4, completed: 3, failed: 1 },
]

describe('QueueThroughputChart', () => {
  it('keeps the date range on one unbreakable line that can wrap under the title', async () => {
    await act(async () => {
      root.render(createElement(MemoryRouter, null, createElement(QueueThroughputChart, { throughput })))
    })
    const range = [...container.querySelectorAll('span')].find((el) => el.textContent?.includes('→'))
    expect(range?.textContent).toBe('2026-10-13 → 2026-10-26')
    expect(range?.classList.contains('whitespace-nowrap')).toBe(true)
    expect(range?.classList.contains('shrink-0')).toBe(true)
    expect(range?.closest('div')?.parentElement?.className).toContain('flex-wrap')
  })
})
