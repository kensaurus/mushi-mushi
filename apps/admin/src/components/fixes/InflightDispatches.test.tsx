/**
 * @vitest-environment jsdom
 */

/**
 * Fixes headed its stopped requests "5 STOPPED DISPATCHES NEED ATTENTION" and
 * its running ones "In-flight dispatches" (console sweep, 2026-10-28).
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { InflightDispatches } from './InflightDispatches'
import type { DispatchJob } from './types'

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

function job(id: string, report: string, status: DispatchJob['status']): DispatchJob {
  return { id, project_id: 'p1', report_id: report, status, created_at: '2026-10-28T00:00:00Z' }
}

describe('InflightDispatches', () => {
  it('names running and stopped fix requests in plain words', async () => {
    await act(async () => {
      root.render(
        createElement(
          MemoryRouter,
          null,
          createElement(InflightDispatches, { dispatches: [job('a', 'r1', 'running'), job('b', 'r2', 'failed'), job('c', 'r3', 'completed_no_pr')] }),
        ),
      )
    })
    const text = container.textContent ?? ''
    expect(text).toContain('Fix requests running')
    expect(text).toContain('2 fix requests stopped without a pull request')
    expect(text).not.toMatch(/dispatch/i)
    // Each request's state is a status pill: running pulses, failed is ✕, no PR is slow.
    const statuses = [...container.querySelectorAll('[data-testid="status-pill"]')].map((p) => p.getAttribute('data-status'))
    expect(statuses).toEqual(['running', 'failed', 'slow'])
  })

  it('splits running from stopped for /fixes (running above the list, stopped inside Automation)', async () => {
    const dispatches = [job('a', 'r1', 'running'), job('b', 'r2', 'failed')]
    const draw = async (show: 'active' | 'stopped') => {
      await act(async () => {
        root.render(createElement(MemoryRouter, null, createElement(InflightDispatches, { dispatches, show })))
      })
      return container.textContent ?? ''
    }
    const active = await draw('active')
    expect(active).toContain('Fix requests running')
    expect(active).not.toContain('stopped without a pull request')
    const stopped = await draw('stopped')
    expect(stopped).toContain('1 fix request stopped without a pull request')
    expect(stopped).not.toContain('Fix requests running')
  })
})
