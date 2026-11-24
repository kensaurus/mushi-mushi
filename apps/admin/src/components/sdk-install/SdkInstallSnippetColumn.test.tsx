/**
 * @vitest-environment jsdom
 *
 * The power-user example is a focusable pre. It needs a region role so its
 * accessible name is allowed (axe aria-prohibited-attr).
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SdkInstallSnippetColumn } from './SdkInstallSnippetColumn'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('SdkInstallSnippetColumn', () => {
  it('names the power-user example as a region', () => {
    act(() => {
      root.render(createElement(SdkInstallSnippetColumn, {
        framework: 'react',
        onFrameworkChange: () => {},
        autoFrameworkApplied: { current: false },
        code: 'init()',
        install: 'npm i @mushi-mushi/web',
      }))
    })
    // Closed until asked (ADR 0069): the example is not in the page until the toggle opens it.
    expect(container.querySelector('pre[aria-label="Power-user API example"]')).toBeNull()
    const toggle = container.querySelector<HTMLButtonElement>('button[aria-controls="sdk-power-apis"]')!
    act(() => toggle.click())
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    const pre = container.querySelector('pre[aria-label="Power-user API example"]')
    expect(pre?.getAttribute('tabindex')).toBe('0')
    expect(pre?.getAttribute('role')).toBe('region')
  })

  it('shows the Script tag and the picked framework as tabs, the rest in one list', () => {
    const picked: string[] = []
    act(() => {
      root.render(createElement(SdkInstallSnippetColumn, {
        framework: 'react',
        onFrameworkChange: (fw: string) => picked.push(fw),
        autoFrameworkApplied: { current: false },
        code: 'init()',
        install: 'npm i @mushi-mushi/web',
      }))
    })
    const tabs = Array.from(container.querySelectorAll('[role="radio"]')).map((b) => b.textContent)
    expect(tabs).toHaveLength(2)
    const select = container.querySelector<HTMLSelectElement>('[data-testid="sdk-framework-other"]')!
    // Every other framework stays one pick away: 12 in all.
    expect(select.querySelectorAll('option[value]:not([value=""])')).toHaveLength(10)
    act(() => {
      select.value = 'vue'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(picked).toEqual(['vue'])
  })
})
