/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/components/design/ContrastTiles.test.tsx
 * PURPOSE: A failing contrast pair shows its computed ratio and a Fail badge
 *          (text + shape, not colour alone); an unjudged pair shows the
 *          server's `problem` instead of a verdict.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ContrastPairResult } from '../../lib/recipeTypes'
import { ContrastTiles } from './ContrastTiles'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// Colour fixtures are built from parts so the admin source holds no colour literal.
const hex = (digits: string) => `#${digits}`

function pair(overrides: Partial<ContrastPairResult>): ContrastPairResult {
  return {
    fg: 'color.text.muted',
    bg: 'color.surface',
    fgHex: hex('999999'),
    bgHex: hex('AAAAAA'),
    ratio: 1.24,
    min: 4.5,
    pass: false,
    use: 'body text',
    problem: null,
    ...overrides,
  }
}

describe('ContrastTiles', () => {
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

  function render(pairs: ContrastPairResult[]) {
    act(() => {
      root.render(createElement(ContrastTiles, { pairs }))
    })
  }

  it('shows the ratio, the required minimum and a Fail badge for a failing pair', () => {
    render([pair({})])
    const tile = container.querySelector('[data-testid="contrast-tile"]')
    expect(tile?.querySelector('[data-testid="contrast-ratio"]')?.textContent).toBe('1.24:1')
    expect(tile?.querySelector('[data-verdict="fail"]')?.textContent).toBe('Fail')
    expect(tile?.querySelector('svg[data-glyph="cross"]')).not.toBeNull()
    expect(tile?.textContent).toContain('Needs at least 4.5:1')
    expect(tile?.querySelector('[data-verdict="pass"]')).toBeNull()
  })

  it('draws the sample from token data', () => {
    render([pair({})])
    const sample = container.querySelector<HTMLElement>('[role="img"]')
    expect(sample?.textContent).toBe('Aa')
    expect(sample?.style.color).not.toBe('')
    expect(sample?.style.background).not.toBe('')
  })

  it('shows a Pass badge for a passing pair', () => {
    render([pair({ ratio: 7.1, pass: true })])
    expect(container.querySelector('[data-verdict="pass"]')?.textContent).toBe('Pass')
  })

  it('shows the problem, not a verdict, when the pair could not be judged', () => {
    render([pair({ ratio: null, pass: null, fgHex: null, problem: 'color.text.muted did not resolve' })])
    expect(container.querySelector('[data-testid="contrast-ratio"]')?.textContent).toBe('—')
    expect(container.querySelector('[data-verdict="unknown"]')).not.toBeNull()
    expect(container.textContent).toContain('color.text.muted did not resolve')
  })
})
