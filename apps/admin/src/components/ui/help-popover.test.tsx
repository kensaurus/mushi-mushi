/**
 * @vitest-environment jsdom
 */

/**
 * "How this page works" (pattern P2): the explainer opens from a header
 * button as a non-modal popover, closes on Escape, and marks the page's help
 * read the first time it opens.
 */

import { act, createElement, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { HelpPopover, PageHelpPopover } from './help-popover'
import { isPageHelpRead } from '../../lib/pageHelpRead'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  window.localStorage.clear()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

async function render(el: ReactElement, path = '/judge') {
  await act(async () => {
    root.render(createElement(MemoryRouter, { initialEntries: [path] }, el))
  })
}

function trigger(): HTMLButtonElement {
  return container.querySelector('[data-testid="help-popover-trigger"]') as HTMLButtonElement
}

describe('HelpPopover', () => {
  it('opens a non-modal dialog with the content and closes on Escape', async () => {
    await render(createElement(HelpPopover, { title: 'How Mushi works', children: createElement('p', null, 'Bugs in, fixes out.') }))
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(trigger().getAttribute('aria-expanded')).toBe('false')

    await act(async () => trigger().click())
    const dialog = document.querySelector('[role="dialog"]')
    expect(dialog?.getAttribute('aria-modal')).toBe('false')
    expect(dialog?.textContent).toContain('Bugs in, fixes out.')
    expect(trigger().getAttribute('aria-expanded')).toBe('true')

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it('closes on a click outside', async () => {
    await render(createElement(HelpPopover, { title: 'Help', children: 'Body' }))
    await act(async () => trigger().click())
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    await act(async () => {
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    })
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })
})

describe('PageHelpPopover', () => {
  it('shows the three help sections and marks the route read on first open', async () => {
    await render(
      createElement(PageHelpPopover, {
        title: 'About triage grading',
        whatIsIt: 'A second model grades each diagnosis.',
        useCases: ['See whether grades improve'],
        howToUse: 'Open a low grade to read why.',
      }),
    )
    // Unread: the trigger carries the first-use dot.
    expect(trigger().querySelector('.bg-brand')).not.toBeNull()
    expect(isPageHelpRead('judge')).toBe(false)

    await act(async () => trigger().click())
    const text = document.querySelector('[role="dialog"]')?.textContent ?? ''
    expect(text).toContain('What it is')
    expect(text).toContain('When to use it')
    expect(text).toContain('How to use it')
    expect(text).toContain('A second model grades each diagnosis.')
    expect(isPageHelpRead('judge')).toBe(true)
    expect(trigger().querySelector('.bg-brand')).toBeNull()
  })
})
