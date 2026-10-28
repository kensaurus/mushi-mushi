/**
 * A signed-out console visit must show a diagnosis, not a password form.
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { matchRoutes, MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SampleReportEntry } from './SampleReportEntry'

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

describe('SampleReportEntry', () => {
  it('is the route a signed-out /reports/sample visit matches', () => {
    const match = matchRoutes(
      [
        { path: '/reports/sample', id: 'sample' },
        { path: '/*', id: 'protected' },
      ],
      '/reports/sample',
    )
    expect(match?.[0]?.route.id).toBe('sample')
  })

  it('shows why the sample broke, with no sign-in form', async () => {
    await act(async () => {
      root.render(createElement(MemoryRouter, null, createElement(SampleReportEntry)))
    })
    const text = host.textContent ?? ''
    expect(text).toContain('Sample')
    expect(text).toContain('Why it broke')
    expect(text).toContain('before creating an account')
    expect(host.querySelector('input')).toBeNull()
    expect(host.querySelector('a[href*="/demo/diagnosis"]')).not.toBeNull()
    expect(host.querySelector('a[href="/signup"]')).not.toBeNull()
    expect(host.querySelector('a[href="/login"]')).not.toBeNull()
  })
})
