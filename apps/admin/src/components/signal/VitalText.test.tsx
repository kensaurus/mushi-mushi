/**
 * @vitest-environment jsdom
 *
 * "Homepage LCP 6408ms" reads as a graded badge, not a sentence (owner,
 * 2026-11-18): shape plus colour plus an accessible name with the grade.
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { VitalText } from './VitalText'

const doc = (text: string) => new DOMParser().parseFromString(renderToStaticMarkup(<VitalText text={text} />), 'text/html')

describe('VitalText', () => {
  it('shows each vital as a graded badge and keeps the words around it', () => {
    const d = doc('Homepage /glot-it/ LCP 6408ms, CLS 0.05')
    const lcp = d.querySelector('[data-testid="vital-LCP"]')!
    expect(lcp.getAttribute('data-grade')).toBe('poor')
    expect(lcp.getAttribute('aria-label')).toBe('LCP 6.4 s, poor')
    expect(lcp.querySelector('svg[data-tone="danger"]')).not.toBeNull()
    expect(d.querySelector('[data-testid="vital-CLS"]')?.getAttribute('data-grade')).toBe('good')
    expect(d.body.textContent).toContain('Homepage /glot-it/ ')
  })

  it('renders text with no vital unchanged', () => {
    expect(renderToStaticMarkup(<VitalText text="Checkout button does nothing" />)).toBe('Checkout button does nothing')
  })
})
