/**
 * @vitest-environment jsdom
 *
 * The copy-link control in every page header showed only a chain icon
 * (Mushi report 3d5c1f99). It must carry a visible action label.
 */

import { act, createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/toast', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }))
vi.mock('./ui', () => ({ Tooltip: ({ children }: { children: ReactNode }) => children }))

import { CopyViewLinkButton } from './CopyViewLinkButton'

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

describe('CopyViewLinkButton', () => {
  it('shows a visible "Copy link" label next to the icon', () => {
    act(() => root.render(createElement(CopyViewLinkButton)))
    const button = container.querySelector('button')
    expect(button?.getAttribute('aria-label')).toBe('Copy link to this filtered view')
    expect(button?.textContent?.trim()).toBe('Copy link')
  })
})
