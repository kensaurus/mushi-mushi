/**
 * @vitest-environment jsdom
 *
 * Developer details sits in a flex row with a freshness pill. CSS gap does
 * not become a space in the accessible name, so the button read
 * "raw signalsnow".
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ReadoutPanel } from './ReadoutPanel'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** Visible text only. Skips aria-hidden and does not invent spaces between elements. */
function visibleText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? ''
  if (node.nodeType !== Node.ELEMENT_NODE) return ''
  const el = node as Element
  if (el.getAttribute('aria-hidden') === 'true') return ''
  let out = ''
  for (const child of el.childNodes) out += visibleText(child)
  return out
}

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
          { title: 'MCP readout', freshness: { at: new Date(Date.now() + 200).toISOString() } },
          'endpoints',
        ),
      )
    })
    const button = host.querySelector('button')
    expect(button).not.toBeNull()
    expect(button!.getAttribute('aria-label')).toBeNull()
    const name = visibleText(button!).replace(/\s+/g, ' ')
    expect(name).toMatch(/raw signals \S/)
  })
})
