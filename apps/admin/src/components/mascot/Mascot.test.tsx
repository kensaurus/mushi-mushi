/**
 * @vitest-environment jsdom
 *
 * The field guide's figure is decoration, the line is the content: assistive
 * tech reads the line and skips the image, and a failed image never leaves a
 * broken-image icon on an error screen.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { Mascot } from './Mascot'

let root: Root | null = null
let host: HTMLDivElement | null = null

function render(props: Parameters<typeof Mascot>[0]): HTMLDivElement {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => {
    root!.render(createElement(Mascot, props))
  })
  return host
}

afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  root = null
  host = null
})

describe('Mascot', () => {
  it('hides the figure from assistive tech and keeps the line as text', () => {
    const el = render({ pose: 'found', line: "Found it. Here's what broke." })
    const img = el.querySelector('img')!
    expect(img.getAttribute('alt')).toBe('')
    expect(img.closest('[aria-hidden="true"]')).not.toBeNull()
    expect(el.textContent).toContain("Found it. Here's what broke.")
    expect(el.querySelector('[data-mascot-pose="found"]')).not.toBeNull()
  })

  it('offers both renders so the browser picks the sharp one', () => {
    const img = render({ pose: 'wave', size: 'lg' }).querySelector('img')!
    expect(img.getAttribute('srcset')).toMatch(/300w, .+ 600w$/)
    expect(img.getAttribute('width')).toBe('144')
  })

  it('drops the figure when the image fails, and keeps the line', () => {
    const el = render({ pose: 'oops', line: 'That crash is on us.' })
    act(() => {
      el.querySelector('img')!.dispatchEvent(new Event('error'))
    })
    expect(el.querySelector('img')).toBeNull()
    expect(el.textContent).toContain('That crash is on us.')
  })

  it('renders no line block when there is no line', () => {
    const el = render({ pose: 'think' })
    expect(el.querySelectorAll('p')).toHaveLength(0)
  })
})
