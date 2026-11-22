/**
 * @vitest-environment jsdom
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { MiniInlineBar, RecommendedAction } from './metrics'

describe('MiniInlineBar', () => {
  it('is a named meter with range values when labeled', () => {
    const html = renderToStaticMarkup(<MiniInlineBar value={30} max={60} aria-label="Confidence" />)
    expect(html).toContain('role="meter"')
    expect(html).toContain('aria-valuenow="50"')
  })

  it('puts no range ARIA on an unlabeled bar and hides it instead', () => {
    const html = renderToStaticMarkup(<MiniInlineBar value={30} />)
    expect(html).not.toContain('aria-valuenow')
    expect(html).toContain('aria-hidden="true"')
  })
})

// A disabled "Dispatch fix" said why only to someone who hovered it (feedback 2026-11-22).
describe('RecommendedAction CTA note', () => {
  it('shows the note under a disabled CTA, describes the button with it, and keeps the hover text', () => {
    const host = document.createElement('div')
    host.innerHTML = renderToStaticMarkup(
      <RecommendedAction
        title="Triage this report"
        cta={{ label: 'Dispatch fix', onClick: () => {}, disabled: true, title: 'Set up first: Autofix enabled.' }}
        ctaNote={<span>To dispatch a fix: Turn on Autofix (3 of 4 done)</span>}
      />,
    )
    const button = host.querySelector('button')!
    expect(button.disabled).toBe(true)
    expect(button.title).toBe('Set up first: Autofix enabled.')
    const note = host.querySelector(`[id="${button.getAttribute('aria-describedby')}"]`)
    expect(note?.textContent).toBe('To dispatch a fix: Turn on Autofix (3 of 4 done)')
  })

  it('renders the CTA alone without a note', () => {
    const html = renderToStaticMarkup(<RecommendedAction title="t" cta={{ label: 'Go', onClick: () => {} }} />)
    expect(html).not.toContain('aria-describedby')
  })
})
