/**
 * @vitest-environment jsdom
 *
 * ReportPicker: a bug is picked by its title, never by a pasted id. The
 * list reads the active app's newest bugs, a search term goes to `?q=`, a
 * click hands the whole row to the caller, and "Change" clears it.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ data: null as unknown, error: null as string | null, loading: false, paths: [] as Array<string | null> }))

vi.mock('../../lib/usePageData', () => ({
  usePageData: (path: string | null) => {
    state.paths.push(path)
    return { data: state.data, loading: state.loading, error: state.error, isValidating: false, reload: vi.fn(), lastFetchedAt: null }
  },
}))

import { ReportPicker, reportPickerPath, reportPickerTitle, type PickableReport } from './ReportPicker'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  state.data = null
  state.error = null
  state.loading = false
  state.paths = []
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

function render(value: PickableReport | null, onChange = vi.fn()) {
  act(() => {
    root.render(createElement(MemoryRouter, null, createElement(ReportPicker, { value, onChange })))
  })
  return onChange
}

describe('reportPickerTitle', () => {
  it('prefers the friendly title, then the summary, then the description', () => {
    expect(reportPickerTitle({ id: 'a', title: 'Checkout button dead', summary: 's' })).toBe('Checkout button dead')
    expect(reportPickerTitle({ id: 'a', summary: 'Login\n  loops' })).toBe('Login loops')
    expect(reportPickerTitle({ id: 'abcdef1234' })).toBe('Bug abcdef12')
  })
})

describe('reportPickerPath', () => {
  it('lists the newest bugs and sends a search term as q', () => {
    expect(reportPickerPath('', 6)).toBe('/v1/admin/reports?limit=6&sort=created_at&dir=desc')
    expect(reportPickerPath(' checkout ', 6)).toContain('&q=checkout')
    expect(reportPickerPath('', 6, 'status=new')).toMatch(/&status=new$/)
  })
})

describe('ReportPicker', () => {
  it('lists bugs by title and hands the picked row to the caller', () => {
    state.data = {
      reports: [
        { id: '11111111-aaaa', title: 'Checkout button does nothing', severity: 'high', created_at: new Date().toISOString() },
        { id: '22222222-bbbb', summary: 'Avatar upload fails' },
      ],
    }
    const onChange = render(null)
    const buttons = Array.from(host.querySelectorAll('ul button')) as HTMLButtonElement[]
    expect(buttons.map((b) => b.textContent)).toEqual([
      expect.stringContaining('Checkout button does nothing'),
      expect.stringContaining('Avatar upload fails'),
    ])
    act(() => buttons[0].click())
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ id: '11111111-aaaa' }))
    expect(host.textContent).not.toMatch(/paste/i)
  })

  it('says so when the app has no bugs, and when loading fails', () => {
    state.data = { reports: [] }
    render(null)
    expect(host.textContent).toContain('No bugs on this app yet.')
    state.error = 'boom'
    render(null)
    expect(host.textContent).toContain("Couldn't load your bugs")
  })

  it('shows the picked bug with Change, and stops fetching while one is picked', () => {
    const onChange = render({ id: '33333333-cccc', title: 'Dark mode flashes white' })
    expect(host.textContent).toContain('Dark mode flashes white')
    expect(state.paths.at(-1)).toBeNull()
    const change = Array.from(host.querySelectorAll('button')).find((b) => b.textContent === 'Change')!
    act(() => change.click())
    expect(onChange).toHaveBeenCalledWith(null)
  })
})
