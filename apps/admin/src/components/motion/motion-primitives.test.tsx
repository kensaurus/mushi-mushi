/**
 * FILE: apps/admin/src/components/motion/motion-primitives.test.tsx
 * PURPOSE: Motion primitive contracts — disclosure grid, reduced motion, SpringChromeEnter.
 */

import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { AnimatedDisclosure } from './AnimatedDisclosure'
import { SpringChromeEnter } from './SpringChromeEnter'

describe('AnimatedDisclosure', () => {
  it('renders children when open', () => {
    const html = renderToStaticMarkup(
      <AnimatedDisclosure open contentKey="test">
        <a href="/reports">Reports</a>
      </AnimatedDisclosure>,
    )
    expect(html).toContain('Reports')
    expect(html).toContain('display:grid')
  })

  it('hides children when closed', () => {
    const html = renderToStaticMarkup(
      <AnimatedDisclosure open={false} contentKey="test">
        <a href="/reports">Reports</a>
      </AnimatedDisclosure>,
    )
    expect(html).not.toContain('Reports')
  })
})

describe('SpringChromeEnter', () => {
  it('renders children with motion wrapper', () => {
    const html = renderToStaticMarkup(
      <SpringChromeEnter>
        <p>Banner copy</p>
      </SpringChromeEnter>,
    )
    expect(html).toContain('Banner copy')
    expect(html).toContain('opacity:0')
  })
})
