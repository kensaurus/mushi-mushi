/**
 * @vitest-environment jsdom
 */

/**
 * Pattern P2 (console journeys 2026-10-27): a page's "What it is / When to
 * use it / How to use it" help opens from "How this page works" in its
 * header. It shows expanded under the content only on an empty page (a
 * PageFirstStep is mounted) or when the user keeps tips open; the
 * "Related:" links stay either way.
 */

import { act, createElement, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PageHeaderBar } from './PageHeaderBar'
import { RoutePageHelp } from './RoutePageHelp'
import { PageFirstStep } from './ui/page-first-step'
import { PageHelpProvider } from '../lib/pageHelpContext'
import { writePageHelpAlwaysOpen } from '../lib/pageHelpPrefs'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  window.localStorage.clear()
  // PageHeaderBar reads the viewport through matchMedia; jsdom has none.
  window.matchMedia = ((q: string) => ({
    matches: false,
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
  })) as unknown as typeof window.matchMedia
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function page(empty: boolean): ReactElement {
  return createElement(
    MemoryRouter,
    { initialEntries: ['/judge'] },
    createElement(
      PageHelpProvider,
      null,
      createElement(PageHeaderBar, {
        title: 'Triage grading',
        helpTitle: 'About triage grading',
        helpWhatIsIt: 'A second model grades each diagnosis.',
        helpUseCases: ['See whether grades improve'],
      }),
      empty
        ? createElement(PageFirstStep, { title: 'Nothing graded yet', sentence: 'Run the grader once.', action: { label: 'Run now', to: '/judge' } })
        : createElement('p', null, 'Grades table'),
      createElement(RoutePageHelp),
    ),
  )
}

async function render(el: ReactElement) {
  await act(async () => {
    root.render(el)
  })
}

describe('RoutePageHelp', () => {
  it('keeps the explainer in the header popover on a page with data', async () => {
    await render(page(false))
    expect(container.querySelector('[data-testid="help-popover-trigger"]')).not.toBeNull()
    expect(container.textContent).not.toContain('What it is')
    // The cross-links stay visible under the content (owner, 2026-10-08).
    expect(container.querySelector('nav[aria-label="Related pages"]')).not.toBeNull()
  })

  it('shows the explainer expanded under an empty page', async () => {
    await render(page(true))
    const details = container.querySelector('details')
    expect(details).not.toBeNull()
    expect(details?.open).toBe(true)
    expect(container.textContent).toContain('What it is')
  })

  it('shows it expanded when the user keeps tips open', async () => {
    writePageHelpAlwaysOpen(true)
    await render(page(false))
    expect(container.querySelector('details')?.open).toBe(true)
  })
})
