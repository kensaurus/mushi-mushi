/**
 * @vitest-environment jsdom
 *
 * SecretInput is the one field for API keys, tokens and webhook secrets. A
 * `type="password"` field made browsers and password managers offer to save
 * the key as the site login ("Update login details?"), so it is masked text
 * with every manager opted out. Real login passwords keep type="password".
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Input, SecretInput } from './forms'

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

function render(node: Parameters<Root['render']>[0]) {
  act(() => root.render(node))
  return host.querySelector('input') as HTMLInputElement
}

describe('SecretInput', () => {
  it('renders masked text with password managers, autocomplete and spellcheck off', () => {
    const input = render(createElement(SecretInput, { value: 'sk-proj-FAKE0001', onChange: () => {} }))
    expect(input.type).toBe('text')
    expect(input.getAttribute('autocomplete')).toBe('off')
    expect(input.getAttribute('spellcheck')).toBe('false')
    expect(input.getAttribute('autocapitalize')).toBe('off')
    expect(input.hasAttribute('data-1p-ignore')).toBe(true)
    expect(input.getAttribute('data-lpignore')).toBe('true')
    expect(input.hasAttribute('data-bwignore')).toBe(true)
    expect(input.getAttribute('data-form-type')).toBe('other')
    // Keeps the console's own screenshot capture redacting it.
    expect(input.hasAttribute('data-mushi-mask')).toBe(true)
    expect(input.className).toContain('[-webkit-text-security:disc]')
  })

  it('Show reveals the value and stays type="text"', () => {
    const input = render(createElement(SecretInput, { value: 'sk-proj-FAKE0001', onChange: () => {} }))
    const toggle = host.querySelector('button[aria-label="Show value"]') as HTMLButtonElement
    expect(toggle).not.toBeNull()
    act(() => toggle.click())
    expect(input.type).toBe('text')
    expect(input.className).not.toContain('[-webkit-text-security:disc]')
    expect(host.querySelector('button[aria-label="Hide value"]')).not.toBeNull()
  })

  it('shows a field-level error under the input', () => {
    render(createElement(SecretInput, { value: 'x', onChange: () => {}, error: 'Paste the API key.' }))
    expect(host.textContent).toContain('Paste the API key.')
    expect(host.querySelector('input')?.getAttribute('aria-invalid')).toBe('true')
  })

  it('a real password field is unchanged', () => {
    const input = render(createElement(Input, { type: 'password', value: 'x', onChange: () => {} }))
    expect(input.type).toBe('password')
    expect(input.hasAttribute('data-1p-ignore')).toBe(false)
  })
})
