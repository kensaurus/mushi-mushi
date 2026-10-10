/**
 * @vitest-environment jsdom
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { MiniInlineBar } from './metrics'

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
