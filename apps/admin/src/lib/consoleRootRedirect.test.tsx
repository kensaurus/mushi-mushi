/**
 * FILE: apps/admin/src/lib/consoleRootRedirect.test.tsx
 * PURPOSE: The console root opens Home (/dashboard) and keeps `?project=`.
 *
 * Opening `/admin/?project=<id>` used to land with no query, and the header
 * then wrote the previously stored app into the URL.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { ConsoleRootRedirect } from './consoleRootRedirect'

const PROJECT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | undefined
let host: HTMLDivElement | undefined
let here = ''

function LocationProbe() {
  const loc = useLocation()
  here = `${loc.pathname}${loc.search}${loc.hash}`
  return null
}

function render(url: string) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => {
    root!.render(
      createElement(
        MemoryRouter,
        { initialEntries: [url] },
        createElement(
          Routes,
          null,
          createElement(Route, { path: '/', element: createElement(ConsoleRootRedirect) }),
          createElement(Route, { path: '/dashboard', element: createElement(LocationProbe) }),
        ),
      ),
    )
  })
}

afterEach(() => {
  if (root) act(() => root!.unmount())
  root = undefined
  host?.remove()
  host = undefined
  here = ''
})

describe('ConsoleRootRedirect', () => {
  it('sends / to Home (/dashboard)', () => {
    render('/')
    expect(here).toBe('/dashboard')
  })

  it('keeps ?project= so the linked app wins over the stored one', () => {
    render(`/?project=${PROJECT}`)
    expect(here).toBe(`/dashboard?project=${PROJECT}`)
  })

  it('keeps the rest of the query and the hash', () => {
    render(`/?project=${PROJECT}&org=${ORG}#queue`)
    expect(here).toBe(`/dashboard?project=${PROJECT}&org=${ORG}#queue`)
  })
})
