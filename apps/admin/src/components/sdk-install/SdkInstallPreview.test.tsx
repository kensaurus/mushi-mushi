/**
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { SdkInstallPreview } from './SdkInstallPreview'
import { DEFAULT_SDK_CONFIG, type SdkPreviewConfig } from '../../lib/sdkSnippets'

const ASSISTANT = { enabled: false, label: '', greeting: '' }
let root: Root | null = null
let host: HTMLDivElement | null = null

function mount(config: Partial<SdkPreviewConfig> = {}) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => {
    root!.render(createElement(SdkInstallPreview, { config: { ...DEFAULT_SDK_CONFIG, ...config }, assistant: ASSISTANT }))
  })
  return host
}

const q = <T extends Element = HTMLElement>(sel: string) => host!.querySelector(sel) as T | null
const click = (el: Element | null) => act(() => { (el as HTMLElement).click() })

afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  root = null
  host = null
})

describe('SdkInstallPreview — mirrors the one-screen report', () => {
  it('opens on the report screen: text box first, the five chips, attachments, privacy, pinned Send', () => {
    mount({ capture: { ...DEFAULT_SDK_CONFIG.capture, elementSelector: true } })
    click(q('[aria-label^="Mock bug-capture trigger"]'))
    const panel = q('[data-testid="preview-panel"]')!
    expect(panel.getAttribute('aria-label')).toBe('Send feedback')
    expect(q<HTMLTextAreaElement>('textarea')!.placeholder).toBe('What went wrong?')
    expect(Array.from(panel.querySelectorAll('[role="radio"]')).map((c) => c.textContent)).toEqual([
      'Bug', 'Slow', 'Looks wrong', 'Confusing', 'Idea',
    ])
    expect(panel.textContent).toContain('Screenshot')
    expect(panel.textContent).toContain('Point at it')
    expect(panel.textContent).toContain('Shown only to the app’s developer')
    expect(panel.textContent).toContain('Your reports')
    // None of the retired 3-step copy.
    expect(panel.textContent).not.toMatch(/What kind of issue|Report an issue|Something is broken/)
  })

  it('Send stays disabled with the reason until there are a few words, then shows the receipt', () => {
    mount()
    click(q('[aria-label^="Mock bug-capture trigger"]'))
    const send = () => Array.from(host!.querySelectorAll('button')).find((b) => /Send|Done/.test(b.textContent ?? ''))!
    expect(send().getAttribute('aria-disabled')).toBe('true')
    expect(q('[data-testid="preview-panel"]')!.textContent).toContain('Add a few words')
    const ta = q<HTMLTextAreaElement>('textarea')!
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
      setter.call(ta, 'The save button does nothing')
      ta.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(send().getAttribute('aria-disabled')).toBe('false')
    click(send())
    expect(q('[data-testid="preview-panel"]')!.textContent).toContain('Sent')
    expect(q('[data-testid="preview-panel"]')!.textContent).toContain("We'll let you know here when there's news.")
  })

  it('the Idea chip switches the placeholder; chips are single-select and optional', () => {
    mount()
    click(q('[aria-label^="Mock bug-capture trigger"]'))
    click(q('[data-category="idea"]'))
    expect(q('[data-category="idea"]')!.getAttribute('aria-checked')).toBe('true')
    expect(q<HTMLTextAreaElement>('textarea')!.placeholder).toBe('Describe your idea…')
    click(q('[data-category="idea"]'))
    expect(q('[data-category="idea"]')!.getAttribute('aria-checked')).toBe('false')
  })

  it('follows the capture settings the card edits', () => {
    mount({ capture: { ...DEFAULT_SDK_CONFIG.capture, screenshot: 'off', elementSelector: false } })
    click(q('[aria-label^="Mock bug-capture trigger"]'))
    expect(q('[data-testid="preview-attachments"]')).toBeNull()
    act(() => root!.unmount())
    host!.remove()

    mount({ capture: { ...DEFAULT_SDK_CONFIG.capture, screenshot: 'auto' }, screenshotSensitiveHint: 'Hide balances first.' })
    click(q('[aria-label^="Mock bug-capture trigger"]'))
    expect(q('[data-testid="preview-attachments"]')!.textContent).toContain('Screenshot attached')
    expect(q('[data-testid="preview-shot-hint"]')!.textContent).toBe('Hide balances first.')
  })

  it('the banner "Report a bug" opens the report with Bug picked', () => {
    mount({ trigger: 'banner', bannerBugCta: 'Report a bug' })
    click(Array.from(q('[data-testid="preview-banner"]')!.querySelectorAll('button')).find((b) => b.textContent === 'Report a bug')!)
    expect(q('[data-category="bug"]')!.getAttribute('aria-checked')).toBe('true')
  })

  it('uses the chosen colour scheme with the widget’s system colours', () => {
    mount({ theme: 'dark' })
    expect(q<HTMLElement>('[data-testid="sdk-install-preview"]')!.style.colorScheme).toBe('dark')
  })
})
