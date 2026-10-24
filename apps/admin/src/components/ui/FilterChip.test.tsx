/**
 * FILE: apps/admin/src/components/ui/FilterChip.test.tsx
 * PURPOSE: A chip whose count is still loading (null) keeps the badge's
 *          width, so a row of chips does not widen and wrap when the counts
 *          land (Bugs quick filters, layout shift, 2026-10-24).
 */

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { FilterChip } from './misc'

const html = (count: number | null | undefined) =>
  renderToStaticMarkup(<FilterChip label="Open" count={count} active={false} onClick={vi.fn()} />)

describe('FilterChip count', () => {
  it('reserves the badge while the count loads (null)', () => {
    const out = html(null)
    expect(out).toContain('aria-hidden="true"')
    expect(out).toContain('min-w-4')
    expect(out).not.toContain('results')
  })

  it('shows the number once it is known', () => {
    expect(html(22)).toContain('aria-label="22 results"')
  })

  it('has no badge at all when the chip has no count (undefined)', () => {
    const out = html(undefined)
    expect(out).not.toContain('min-w-4')
    expect(out).not.toContain('results')
  })
})
