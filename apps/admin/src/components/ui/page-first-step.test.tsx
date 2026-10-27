/**
 * @vitest-environment jsdom
 */

/**
 * PageFirstStep (pattern P3): one sentence, one button, an optional "learn
 * more", and while it is on screen the page counts as empty so its help
 * opens under it.
 */

import { act, createElement, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PageFirstStep } from './page-first-step'
import { PageHelpProvider, usePageIsEmpty } from '../../lib/pageHelpContext'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

async function render(el: ReactElement) {
  await act(async () => {
    root.render(createElement(MemoryRouter, null, createElement(PageHelpProvider, null, el)))
  })
}

function EmptyProbe() {
  return createElement('output', { 'data-testid': 'probe' }, usePageIsEmpty() ? 'empty' : 'full')
}

describe('PageFirstStep', () => {
  it('renders one sentence, one button and the learn-more link', async () => {
    await render(
      createElement(PageFirstStep, {
        title: 'No schema scan yet',
        sentence: 'Run the first scan to see when your API or database changes.',
        action: { label: 'Run first scan', to: '/health?view=schema' },
        learnMore: { href: 'https://example.test/docs' },
      }),
    )
    expect(container.querySelector('h3')?.textContent).toBe('No schema scan yet')
    const link = container.querySelector('a[href="/health?view=schema"]')
    expect(link?.textContent).toContain('Run first scan')
    const more = container.querySelector('a[href="https://example.test/docs"]')
    expect(more?.textContent).toContain('Learn more')
    expect(more?.getAttribute('target')).toBe('_blank')
  })

  it('calls onClick for a button action', async () => {
    const onClick = vi.fn()
    await render(createElement(PageFirstStep, { title: 'Empty', sentence: 'Start.', action: { label: 'Start', onClick } }))
    const btn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('Start'))
    await act(async () => btn?.click())
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('marks the page empty while mounted, and not after', async () => {
    const card = createElement(PageFirstStep, { key: 'c', title: 'Empty', sentence: 'Start.', action: { label: 'Go', to: '/x' } })
    await render(createElement('div', null, card, createElement(EmptyProbe, { key: 'p' })))
    expect(container.querySelector('[data-testid="probe"]')?.textContent).toBe('empty')
    await render(createElement('div', null, createElement(EmptyProbe, { key: 'p' })))
    expect(container.querySelector('[data-testid="probe"]')?.textContent).toBe('full')
  })

  it('leaves the page alone when marksPageEmpty is false', async () => {
    await render(
      createElement(
        'div',
        null,
        createElement(PageFirstStep, { key: 'c', title: 'Empty', sentence: 'Start.', action: { label: 'Go', to: '/x' }, marksPageEmpty: false }),
        createElement(EmptyProbe, { key: 'p' }),
      ),
    )
    expect(container.querySelector('[data-testid="probe"]')?.textContent).toBe('full')
  })
})
