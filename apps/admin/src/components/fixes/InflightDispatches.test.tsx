/**
 * @vitest-environment jsdom
 *
 * In-flight dispatches keep the h3 they had before /fixes promoted its
 * sections. The fixes page passes h2 so the heading sits under that page's h1.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { DispatchJob } from './types'
import { InflightDispatches } from './InflightDispatches'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const job = (over: Partial<DispatchJob> = {}): DispatchJob => ({
  id: 'd1',
  project_id: 'p1',
  report_id: 'r1',
  status: 'queued',
  created_at: '2026-10-24T00:00:00Z',
  ...over,
})

let root: Root
let host: HTMLDivElement

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

function render(heading?: 'h2' | 'h3') {
  act(() => {
    root.render(
      createElement(
        MemoryRouter,
        null,
        createElement(InflightDispatches, { dispatches: [job()], ...(heading ? { heading } : {}) }),
      ),
    )
  })
}

describe('InflightDispatches', () => {
  it('stays an h3 unless the page asks for an h2', () => {
    render()
    expect(host.querySelector('h3')?.textContent).toBe('In-flight dispatches')
    expect(host.querySelector('h2')).toBeNull()

    render('h2')
    expect(host.querySelector('h2')?.textContent).toBe('In-flight dispatches')
    expect(host.querySelector('h3')).toBeNull()
  })
})
