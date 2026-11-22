/**
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { AccentField } from './AccentField'

let root: Root | null = null
let host: HTMLDivElement | null = null

function mount(value: string, onChange = vi.fn()) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root!.render(createElement(AccentField, { value, onChange })))
  return onChange
}

afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  root = null
  host = null
})

describe('AccentField', () => {
  it('starts on Auto with no colour inputs and says what Auto does', () => {
    mount('')
    expect((host!.querySelector('input[type="checkbox"]') as HTMLInputElement).checked).toBe(true)
    expect(host!.querySelector('input[type="color"]')).toBeNull()
    expect(host!.textContent).toContain("uses your site's accent colour")
  })

  it('turning Auto off picks a starting colour', () => {
    const onChange = mount('')
    act(() => (host!.querySelector('input[type="checkbox"]') as HTMLInputElement).click())
    expect(onChange).toHaveBeenCalledWith(expect.stringMatching(/^#[0-9a-f]{6}$/))
  })

  it('shows the text colour and contrast the server will serve', () => {
    // mushi-mushi-allowlist: a widget colour under test, not a console UI colour.
    mount('#1e3a8a')
    expect(host!.querySelector('[data-testid="accent-contrast"]')!.textContent).toContain('white, 10.4:1')
  })
})
