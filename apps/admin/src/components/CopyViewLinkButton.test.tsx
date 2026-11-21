/**
 * @vitest-environment jsdom
 *
 * The copy-link control in every page header showed only a chain icon
 * (Mushi report 3d5c1f99). It must carry a visible action label, copy the
 * filtered URL on click and say "Copied" once the write succeeds.
 */

import { act, createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/toast', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }))
vi.mock('./ui', () => ({ Tooltip: ({ children }: { children: ReactNode }) => children }))

import { CopyViewLinkButton } from './CopyViewLinkButton'

let container: HTMLDivElement
let root: Root
let startUrl: string

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  startUrl = window.location.href
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  window.history.replaceState(null, '', startUrl)
  Reflect.deleteProperty(navigator, 'clipboard')
  vi.unstubAllGlobals()
})

describe('CopyViewLinkButton', () => {
  it('shows a visible "Copy link" label next to the icon', () => {
    act(() => root.render(createElement(CopyViewLinkButton)))
    const button = container.querySelector('button')
    expect(button?.getAttribute('aria-label')).toBe('Copy link to this filtered view')
    expect(button?.textContent?.trim()).toBe('Copy link')
  })

  it('keeps the label on one line and the target unshrunk in a crowded header', () => {
    act(() => root.render(createElement(CopyViewLinkButton)))
    const classes = container.querySelector('button')?.className.split(/\s+/) ?? []
    expect(classes).toContain('whitespace-nowrap')
    expect(classes).toContain('shrink-0')
    expect(classes).toContain('h-7')
  })

  it('copies the filtered view URL and shows "Copied" after the write succeeds', async () => {
    window.history.replaceState(null, '', '/reports?status=open&severity=high#focus')
    const filteredUrl = window.location.href
    let resolveWrite: () => void = () => {}
    const writeText = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveWrite = resolve
        }),
    )
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })

    act(() => root.render(createElement(CopyViewLinkButton)))
    const button = container.querySelector('button')!

    await act(async () => {
      button.click()
    })
    expect(writeText).toHaveBeenCalledWith(filteredUrl)
    // Not confirmed until the clipboard write resolves.
    expect(button.textContent?.trim()).toBe('Copy link')

    await act(async () => {
      resolveWrite()
    })
    expect(button.textContent?.trim()).toBe('Copied')
    expect(button.getAttribute('aria-label')).toBe('View link copied')
  })
})
