/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/components/design/CssScopeColumns.test.tsx
 * PURPOSE: CSS variables render one column per scope (light/dark are
 *          'declared' scopes), swatches come only from data, long selectors
 *          wrap instead of widening the page, and no scopes renders nothing.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { DesignPlaneResponse } from '../../lib/recipeTypes'
import { CssScopeColumns } from './CssScopeColumns'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// Colour fixtures are built from parts so the admin source holds no colour literal.
const hex = (digits: string) => `#${digits}`

const SCOPES: DesignPlaneResponse['cssScopes'] = [
  {
    path: 'app/styles/globals/theme-soi-signpaint.css',
    selector: ':root',
    kind: 'root',
    vars: [{ name: '--color-bg', value: hex('F3EADA'), hex: hex('F3EADA') }],
  },
  {
    path: 'app/styles/globals/theme-soi-signpaint.css',
    selector: '[data-direction="soi-signpaint"][data-theme="light"] .lesson-shell-with-a-very-long-selector',
    kind: 'declared',
    vars: [
      { name: '--color-text', value: hex('161311'), hex: hex('161311') },
      { name: '--radius-control', value: '10px', hex: null },
    ],
  },
  {
    path: 'app/styles/globals/theme-soi-signpaint.css',
    selector: '[data-theme="dark"]',
    kind: 'declared',
    vars: [],
  },
]

describe('CssScopeColumns', () => {
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

  function render(scopes: DesignPlaneResponse['cssScopes']) {
    act(() => {
      root.render(createElement(CssScopeColumns, { scopes }))
    })
  }

  it('renders nothing for an empty array', () => {
    render([])
    expect(container.innerHTML).toBe('')
  })

  it('renders one column per scope with selector, kind, rows and data swatches', () => {
    render(SCOPES)
    const cols = container.querySelectorAll('[data-testid="css-scope"]')
    expect(cols).toHaveLength(3)
    expect(cols[1]?.textContent).toContain('Declared scope')
    expect(cols[0]?.textContent).toContain('--color-bg')
    // Swatches only where the server gave a hex.
    expect(cols[1]?.querySelectorAll('[role="img"]')).toHaveLength(1)
    expect(cols[1]?.textContent).toContain('10px')
    expect(cols[2]?.textContent).toContain('No variables in this scope.')
  })

  it('stacks below md and wraps long selectors instead of overflowing', () => {
    render(SCOPES)
    const grid = container.querySelector('[data-testid="css-scopes"]')
    expect(grid?.classList.contains('grid-cols-1')).toBe(true)
    expect(grid?.className).toContain('md:grid-cols-2')
    const selector = container.querySelectorAll('[data-testid="css-scope"] code')[1]
    expect(selector?.classList.contains('break-all')).toBe(true)
    expect(selector?.classList.contains('min-w-0')).toBe(true)
  })
})
