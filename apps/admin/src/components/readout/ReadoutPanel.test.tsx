/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/components/readout/ReadoutPanel.test.tsx
 * PURPOSE: The developer-details button name keeps a space before the
 *          freshness word ("raw signals now", not "raw signalsnow").
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { formatRelative } from '../ui/metrics'
import { ReadoutPanel } from './ReadoutPanel'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

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

function buttonName(): string {
  const button = host.querySelector('button')
  if (!button) throw new Error('missing developer details button')
  const authored = button.getAttribute('aria-label')
  if (authored) return authored
  return (button.textContent ?? '').replace(/\s+/g, ' ').trim()
}

describe('ReadoutPanel developer details name', () => {
  it('puts a space between raw signals and a freshness of now', () => {
    const at = new Date().toISOString()
    act(() => {
      root.render(createElement(ReadoutPanel, {
        title: 'MCP readout',
        freshness: { at },
        children: 'endpoints',
      }))
    })
    const name = buttonName()
    const rel = formatRelative(at)
    expect(name).toBe(`Developer details · MCP endpoints and raw signals ${rel}`)
    expect(name).not.toContain('signalsnow')
    expect(name).toContain(`signals ${rel}`)
  })

  it('matches the visible words for a settled timestamp', () => {
    const at = new Date(Date.now() - 10 * 60 * 1000).toISOString()
    act(() => {
      root.render(createElement(ReadoutPanel, {
        title: 'MCP readout',
        freshness: { at },
        children: 'endpoints',
      }))
    })
    const button = host.querySelector('button')!
    const rel = formatRelative(at)
    const expected = `Developer details · MCP endpoints and raw signals ${rel}`
    expect(button.getAttribute('aria-label')).toBe(expected)
    expect((button.textContent ?? '').replace(/\s+/g, ' ').trim()).toBe(expected)
  })
})
