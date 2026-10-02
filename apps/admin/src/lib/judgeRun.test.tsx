/**
 * @vitest-environment jsdom
 */

import { describe, expect, it, vi, afterEach } from 'vitest'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { describeJudgeRun, useJudgeRunPrefill } from './judgeRun'

describe('describeJudgeRun', () => {
  it('reports a dispatched batch with the eligible count', () => {
    const out = describeJudgeRun({ dispatched: 1, eligible: 3 })
    expect(out.kind).toBe('dispatched')
    expect(out.receipt).toMatch(/Dispatched 1 project · 3 reports to grade/)
  })

  it('turns an empty server answer into a "nothing to grade" outcome, not a success', () => {
    const out = describeJudgeRun({
      dispatched: 0,
      evaluated: 0,
      reason: 'nothing_to_grade',
      message: 'Nothing new to grade: every classified report already has a judge score.',
    })
    expect(out.kind).toBe('nothing')
    expect(out.title).toBe('Nothing new to grade')
    expect(out.description).toMatch(/already has a judge score/)
  })

  it('names a disabled judge', () => {
    const out = describeJudgeRun({ dispatched: 0, evaluated: 0, reason: 'judge_disabled' })
    expect(out.kind).toBe('nothing')
    expect(out.title).toBe('Judge is turned off')
  })
})

describe('useJudgeRunPrefill', () => {
  let root: Root | null = null
  let container: HTMLDivElement | null = null

  afterEach(() => {
    act(() => root?.unmount())
    container?.remove()
    root = null
    container = null
    vi.restoreAllMocks()
  })

  function render(url: string) {
    const seen: { search: string; highlighted: boolean } = { search: '', highlighted: false }
    function Probe() {
      const highlighted = useJudgeRunPrefill('judge-run-now')
      const loc = useLocation()
      seen.search = loc.search
      seen.highlighted = highlighted
      return createElement('button', { id: 'judge-run-now', type: 'button' }, 'Run judge now')
    }
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => {
      root!.render(createElement(MemoryRouter, { initialEntries: [url] }, createElement(Probe)))
    })
    return seen
  }

  it('focuses and highlights the Run button without making any request', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const seen = render('/judge?action=run&project=p1')
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(document.activeElement?.id).toBe('judge-run-now')
    expect(seen.highlighted).toBe(true)
    // The param is consumed so a reload does not re-highlight; other params stay.
    expect(seen.search).toBe('?project=p1')
  })

  it('does nothing without the param', () => {
    const seen = render('/judge')
    expect(seen.highlighted).toBe(false)
    expect(document.activeElement?.id).not.toBe('judge-run-now')
  })
})
