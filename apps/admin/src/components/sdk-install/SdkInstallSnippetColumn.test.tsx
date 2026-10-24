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
    const pre = container.querySelector('pre[aria-label="Power-user API example"]')
    expect(pre?.getAttribute('tabindex')).toBe('0')
    expect(pre?.getAttribute('role')).toBe('region')
  })
})
