/**
 * @vitest-environment jsdom
 *
 * FILE: apps/admin/src/components/readout/ReadoutPanel.test.tsx
 * PURPOSE: Developer details sits in a flex row with a freshness pill.
 *          CSS gap is not a space, so the button text read "raw signalsnow".
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ReadoutPanel } from './ReadoutPanel'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('ReadoutPanel', () => {
  let host: HTMLDivElement
  let root: Root

  beforeEach(() => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(() => {
    act(() => root.unmount())
    host.remove()
  })

  it('keeps a space before the freshness word in the developer-details name', async () => {
    await act(async () => {
      root.render(
        createElement(
          ReadoutPanel,
          { title: 'MCP readout', freshness: { at: new Date().toISOString() } },
          'endpoints',
        ),
      )
    })
    const button = host.querySelector('button')
    expect(button).not.toBeNull()
    expect(button!.getAttribute('aria-label')).toBeNull()
    const text = button!.textContent ?? ''
    expect(text).not.toContain('signalsnow')
    expect(text).toMatch(/raw signals \S/)
  })
})
