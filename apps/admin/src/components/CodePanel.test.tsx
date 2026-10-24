/**
 * @vitest-environment jsdom
 *
 * Install snippets and the lockfile helper on Connect scroll inside a pre
 * with no controls of their own. The pre has to be a tab stop.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
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
    expect(pre?.getAttribute('aria-label')).toBe('Install snippet')
    expect(pre?.className).toContain('overflow-x-auto')
    expect(pre?.className).toContain('max-h-72')
    expect(pre?.className).toContain('overflow-y-auto')
  })
})
