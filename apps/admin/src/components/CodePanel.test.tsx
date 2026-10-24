/**
 * @vitest-environment jsdom
 *
 * Install snippets and the lockfile helper on Connect scroll inside a pre
 * with no controls of their own. The pre has to be a tab stop.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CodePanel } from './CodePanel'

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

describe('CodePanel', () => {
  it('makes a max-height snippet a keyboard scroll region', () => {
    act(() => {
      root.render(createElement(CodePanel, {
        label: 'Install snippet',
        language: 'bash',
        code: 'npm install @mushi-mushi/web',
        onCopy: () => {},
        copied: false,
        maxHeight: 'max-h-72',
      }))
    })
    const pre = container.querySelector('pre')
    expect(pre?.getAttribute('tabindex')).toBe('0')
    expect(pre?.getAttribute('role')).toBe('region')
    expect(pre?.getAttribute('aria-label')).toBe('Install snippet')
    expect(pre?.className).toContain('overflow-x-auto')
    expect(pre?.className).toContain('max-h-72')
    expect(pre?.className).toContain('overflow-y-auto')
  })

  it('does not tab to a short snippet that does not scroll', () => {
    act(() => {
      root.render(createElement(CodePanel, {
        label: 'Install snippet',
        language: 'bash',
        code: 'npm i',
        onCopy: () => {},
        copied: false,
      }))
    })
    const pre = container.querySelector('pre')
    expect(pre?.hasAttribute('tabindex')).toBe(false)
    expect(pre?.hasAttribute('role')).toBe(false)
    expect(pre?.hasAttribute('aria-label')).toBe(false)
  })

  it('tabs to a snippet only while its content overflows', () => {
    const scrollWidth = vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get')
    const clientWidth = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get')
    scrollWidth.mockReturnValue(480)
    clientWidth.mockReturnValue(120)
    const props = {
      label: 'Install snippet',
      language: 'bash',
      onCopy: () => {},
      copied: false,
    }
    try {
      act(() => {
        root.render(createElement(CodePanel, { ...props, code: 'npm install @mushi-mushi/web' }))
      })
      const overflowing = container.querySelector('pre')
      expect(overflowing?.getAttribute('tabindex')).toBe('0')
      expect(overflowing?.getAttribute('role')).toBe('region')
      expect(overflowing?.getAttribute('aria-label')).toBe('Install snippet')

      scrollWidth.mockReturnValue(120)
      clientWidth.mockReturnValue(120)
      act(() => {
        root.render(createElement(CodePanel, { ...props, code: 'npm i' }))
      })
      const fitted = container.querySelector('pre')
      expect(fitted?.hasAttribute('tabindex')).toBe(false)
      expect(fitted?.hasAttribute('role')).toBe(false)
      expect(fitted?.hasAttribute('aria-label')).toBe(false)
    } finally {
      scrollWidth.mockRestore()
      clientWidth.mockRestore()
    }
  })
})
