/**
 * @vitest-environment jsdom
 *
 * FILE: apps/admin/src/components/integrations/DryRunPanel.test.tsx
 * PURPOSE: The practice-run header keeps "Run dry-run" on one line. At 390px
 *          a side-by-side row squeezed the button to about 58px and the
 *          hyphenated label wrapped onto three lines.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../lib/supabase', () => ({ apiFetch: vi.fn() }))

import { DryRunPanel } from './DryRunPanel'

describe('DryRunPanel', () => {
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

  it('stacks the practice run below sm and keeps the dry-run label on one line', async () => {
    await act(async () => {
      root.render(createElement(DryRunPanel, { projectId: '11111111-1111-4111-8111-111111111111' }))
    })

    const button = Array.from(container.querySelectorAll('button')).find((el) => el.textContent?.includes('Run dry-run'))
    expect(button).toBeTruthy()
    expect(button?.className).toContain('shrink-0')
    expect(button?.className).toContain('whitespace-nowrap')

    const row = button?.parentElement
    expect(row?.className).toContain('flex-col')
    expect(row?.className).toContain('sm:flex-row')
    expect(row?.className).toContain('sm:items-center')
    expect(row?.querySelector('div')?.className).toContain('min-w-0')
  })
})
