/**
 * @vitest-environment jsdom
 *
 * Load failures read as plain English with one way out; the error code and
 * the raw server text stay in a collapsed "Details" (console IA pass,
 * 2026-10-14). Used to be `Failed to load X: <raw API string> (CODE)`.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { PageLoadError } from './PageLoadError'

let root: Root | null = null
let host: HTMLDivElement | null = null

function render(props: Parameters<typeof PageLoadError>[0]): HTMLDivElement {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => {
    root!.render(createElement(MemoryRouter, null, createElement(PageLoadError, props)))
  })
  return host
}

afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  root = null
  host = null
})

describe('PageLoadError', () => {
  it('turns PROJECT_NOT_FOUND into a plain sentence and a way out, code only under Details', () => {
    const el = render({ error: 'Project not found (PROJECT_NOT_FOUND)', resource: 'platform integrations', onRetry: () => {} })
    const alert = el.querySelector('[role="alert"]')!
    expect(alert.querySelector('h4')?.textContent).toBe("Couldn't load platform integrations")
    const visible = alert.querySelector('p')?.textContent ?? ''
    expect(visible).toMatch(/Pick another project/)
    expect(visible).not.toContain('PROJECT_NOT_FOUND')
    const details = alert.querySelector('details')!
    expect(details.open).toBe(false)
    expect(details.textContent).toContain('Code: PROJECT_NOT_FOUND')
    const buttons = [...alert.querySelectorAll('button')].map((b) => b.textContent)
    expect(buttons).toEqual(['Retry', 'Open projects'])
  })

  it('renders nothing without an error', () => {
    expect(render({ error: null }).textContent).toBe('')
  })
})
