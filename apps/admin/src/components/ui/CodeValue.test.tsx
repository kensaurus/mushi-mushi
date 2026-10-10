/**
 * @vitest-environment jsdom
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CodeValue } from './fields'

describe('CodeValue inline', () => {
  it('honours copyable (default true) with a copy button', () => {
    expect(renderToStaticMarkup(<CodeValue value="abc" inline />)).toContain('aria-label="Copy to clipboard"')
  })

  it('renders bare code when copyable is false', () => {
    const html = renderToStaticMarkup(<CodeValue value="abc" inline copyable={false} />)
    expect(html).not.toContain('<button')
    expect(html.startsWith('<code')).toBe(true)
  })
})
