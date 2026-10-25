/**
 * FILE: apps/admin/src/components/ui/SegmentedControl.test.tsx
 * PURPOSE: A scrollable segmented control scrolls sideways instead of
 *          squeezing its tabs: labels stay on one line and a count badge
 *          stays next to its label (Settings tabs at 390px, 2026-10-25).
 */

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { SegmentedControl } from './forms'

const OPTIONS = [
  { id: 'general', label: 'General' },
  { id: 'byok', label: 'AI keys', count: 1 },
  { id: 'web', label: 'Web tools' },
  { id: 'sdk', label: 'SDK & connection' },
] as const

const html = (props: { scrollable?: boolean; wrap?: boolean } = {}) =>
  renderToStaticMarkup(
    <SegmentedControl
      value="general"
      options={OPTIONS}
      onChange={vi.fn()}
      ariaLabel="Settings sections"
      {...props}
    />,
  )

describe('SegmentedControl scroll strip', () => {
  it('keeps every segment at its natural width so the strip scrolls', () => {
    const out = html({ scrollable: true })
    expect(out).toContain('overflow-x-auto')
    expect(out).toContain('w-max')
    // One shrink-0 per segment: none of the four may be squeezed.
    expect(out.match(/shrink-0/g)?.length).toBe(OPTIONS.length)
  })

  it('never wraps a label or splits its count badge', () => {
    const out = html({ scrollable: true })
    expect(out.match(/whitespace-nowrap/g)?.length).toBe(OPTIONS.length)
  })

  it('does not pin segment widths when the control is allowed to wrap', () => {
    const out = html({ wrap: true })
    expect(out).not.toContain('shrink-0')
    expect(out).toContain('whitespace-nowrap')
  })
})
