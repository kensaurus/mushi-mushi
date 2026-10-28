/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/components/integrations/DryRunPanel.test.tsx
 * PURPOSE: The "Run dry-run" control stays one line at phone width. A
 *          side-by-side row at 390px used to shrink the button to ~58px
 *          and wrap the hyphenated label onto three lines.
 *
 * DEPENDENCIES: vitest, react-dom/client, DryRunPanel
 * USAGE: vitest run src/components/integrations/DryRunPanel.test.tsx
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../lib/supabase', () => ({ apiFetch: vi.fn() }))

import { DryRunPanel } from './DryRunPanel'

describe('DryRunPanel at phone width', () => {
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

  it('stacks the action under the copy and keeps the label on one line', () => {
    act(() => {
      root.render(createElement(DryRunPanel, { projectId: '11111111-1111-4111-8111-111111111111' }))
    })

    const button = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('Run dry-run'))
    expect(button).toBeTruthy()
    expect(button?.className).toContain('shrink-0')
    expect(button?.className).toContain('whitespace-nowrap')

    const row = button?.parentElement
    expect(row?.className).toContain('flex-col')
    expect(row?.className).toContain('sm:flex-row')
    expect(row?.className).not.toContain('items-center justify-between')
  })
})
