/**
 * @vitest-environment jsdom
 *
 * FILE: apps/admin/src/components/readout/ReadoutPanel.test.tsx
 * PURPOSE: The freshness chip used to be a flex sibling of "raw signals".
 *          Flex items are separate lines, so stripping that newline made the
 *          developer-details name "raw signalsnow".
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ReadoutPanel } from './ReadoutPanel'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** Flex items are blockified, so their text is joined with newlines and a
 *  whitespace-only node between them is not a space. Strip those newlines the
 *  way the reported name did. */
function flexJoinedName(root: HTMLElement): string {
  const read = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? ''
    if (node.nodeType !== Node.ELEMENT_NODE) return ''
    const el = node as HTMLElement
    if (el.getAttribute('aria-hidden') === 'true') return ''
    if (el.classList.contains('flex')) {
      const parts: string[] = []
      for (const child of el.childNodes) {
        if (child.nodeType !== Node.ELEMENT_NODE) continue
        if ((child as Element).getAttribute('aria-hidden') === 'true') continue
        parts.push(read(child).trim())
      }
      return parts.filter(Boolean).join('\n')
    }
    let out = ''
    for (const child of el.childNodes) out += read(child)
    return out
  }
  return read(root).replace(/\n/g, '')
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
        createElement(ReadoutPanel, {
          title: 'MCP readout',
          freshness: { at: new Date().toISOString() },
          children: 'endpoints',
        }),
      )
    })
    const button = host.querySelector('button')
    expect(button).not.toBeNull()
    const status = button!.querySelector('[role="status"]')
    expect(status).not.toBeNull()
    expect(status!.parentElement?.classList.contains('flex')).toBe(false)
    expect(status!.previousSibling?.nodeType).toBe(Node.TEXT_NODE)
    expect(status!.previousSibling?.textContent).toBe(' ')
    const name = flexJoinedName(button!)
    expect(name).not.toContain('signalsnow')
    expect(name).toMatch(/raw signals \S/)
  })
})
