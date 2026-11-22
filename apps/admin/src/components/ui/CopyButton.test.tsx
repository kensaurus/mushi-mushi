/**
 * FILE: apps/admin/src/components/ui/CopyButton.test.tsx
 * PURPOSE: The copy button meets the 24px hit-area floor (WCAG 2.5.8) that
 *          Btn and SegmentedControl keep, and grows to 32px on touch
 *          (report 44ac4ce2: compact action targets on /connect).
 */

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CopyButton } from './fields'

describe('CopyButton hit area', () => {
  it('sm is at least 24px, 32px on coarse pointers', () => {
    const html = renderToStaticMarkup(<CopyButton value="mushi upgrade" />)
    expect(html).toContain('h-6 w-6')
    expect(html).toContain('pointer-coarse:h-8 pointer-coarse:w-8')
    expect(html).not.toContain('h-5 w-5')
  })

  it('md keeps 28px and grows on coarse pointers', () => {
    const html = renderToStaticMarkup(<CopyButton value="x" size="md" />)
    expect(html).toContain('h-7 w-7')
    expect(html).toContain('pointer-coarse:h-8 pointer-coarse:w-8')
  })
})
