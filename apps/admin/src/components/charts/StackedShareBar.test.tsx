/**
 * @vitest-environment jsdom
 *
 * "Who opens fixes: server 0 · local 5 · nobody 5" as a picture (owner's
 * walkthrough, 2026-11-17): widths follow the counts, empty parts take no
 * room, the legend keeps every number with its own glyph.
 */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import { StackedShareBar } from './StackedShareBar'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('StackedShareBar', () => {
  it('sizes each part by its share and labels them all', () => {
    const host = document.createElement('div')
    const root = createRoot(host)
    act(() =>
      root.render(
        createElement(StackedShareBar, {
          ariaLabel: 'Apps by who opened a fix',
          segments: [
            { key: 'server', label: 'Server', value: 0, barClass: 'bg-brand', textClass: 'text-brand', glyph: '●' },
            { key: 'local', label: 'Local', value: 5, barClass: 'bg-info', textClass: 'text-info', glyph: '■' },
            { key: 'nobody', label: 'Nobody', value: 5, barClass: 'bg-danger', textClass: 'text-danger', glyph: '▲' },
          ],
        }),
      ),
    )
    const bar = host.querySelector('[data-testid="stacked-share-bar"]')!
    expect(bar.getAttribute('aria-label')).toBe('Apps by who opened a fix: Server 0, Local 5, Nobody 5')
    const parts = Array.from(bar.querySelectorAll('[data-segment]')) as HTMLElement[]
    expect(parts.map((p) => [p.dataset.segment, p.style.width])).toEqual([
      ['local', '50%'],
      ['nobody', '50%'],
    ])
    expect(host.textContent).toContain('●Server0')
    act(() => root.unmount())
  })
})
