/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/components/design/DesignAtAGlance.test.tsx
 * PURPOSE: The design page (console journeys 2026-10-27): with no token files
 *          it is one first step, without recipe-file jargon; once set up it
 *          leads with the colour swatches and "drift from your design" over
 *          time, unscored checks left out (never drawn as 0).
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('../../lib/supabase', () => ({ apiFetch: vi.fn(), apiFetchMutate: vi.fn() }))

import type { DesignPlaneResponse, DesignToken } from '../../lib/recipeTypes'
import { DesignAtAGlance, swatchTokens } from './DesignAtAGlance'
import { designNotSetUp } from '../../pages/DesignPage'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function token(path: string, type: DesignToken['type'], hex: string | null, display = hex ?? '16px'): DesignToken {
  return { path, type, value: display, display, hex, px: null, aliasOf: null, cssVar: null, ts: null, rn: null, description: null, file: 't.json', role: 'source', group: path.split('.')[0]! }
}

function design(tokens: DesignToken[], trend: DesignPlaneResponse['deviance']['trend']): DesignPlaneResponse {
  return { tokens, deviance: { latest: null, trend, topFindings: [] } } as unknown as DesignPlaneResponse
}

let host: HTMLDivElement
let root: Root
beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe('designNotSetUp', () => {
  it('is true only when no token and no set was read', () => {
    expect(designNotSetUp({ tokens: [], sets: [] })).toBe(true)
    expect(designNotSetUp({ tokens: [token('color.a', 'color', null, 'rgb(255 0 0)')], sets: [] })).toBe(false)
  })
})

describe('swatchTokens', () => {
  it('keeps colour tokens with a drawable colour, up to the cap', () => {
    const tokens = [token('color.a', 'color', null, 'rgb(255 0 0)'), token('space.1', 'dimension', null), token('color.b', 'color', null, 'oklch(0.7 0.1 200)'), token('color.c', 'color', null, 'rgb(0 255 0)')]
    expect(swatchTokens(tokens, 2)).toEqual([
      { path: 'color.a', color: 'rgb(255 0 0)' },
      { path: 'color.b', color: 'oklch(0.7 0.1 200)' },
    ])
  })
})

describe('DesignAtAGlance', () => {
  it('shows the swatches and the drift line, leaving unscored checks out', () => {
    act(() =>
      root.render(
        createElement(DesignAtAGlance, {
          design: design([token('color.a', 'color', null, 'rgb(255 0 0)'), token('color.b', 'color', null, 'rgb(0 0 255)')], [
            { at: '2026-10-01T00:00:00Z', score: 40, status: 'warn' },
            { at: '2026-10-05T00:00:00Z', score: null, status: 'error' },
            { at: '2026-10-09T00:00:00Z', score: 22, status: 'pass' },
          ] as DesignPlaneResponse['deviance']['trend']),
        }),
      ),
    )
    expect(host.querySelectorAll('ul[aria-label="Colour tokens"] li')).toHaveLength(2)
    expect(host.textContent).toContain('Drift from your design')
    // Two scored checks, so two rows of values in the screen-reader table.
    expect(host.querySelectorAll('table.sr-only tbody tr')).toHaveLength(2)
  })

  it('says what to do when nothing has been scored', () => {
    act(() => root.render(createElement(DesignAtAGlance, { design: design([], []) })))
    expect(host.textContent).toContain('No drift check has been scored yet.')
    expect(host.querySelector('[data-testid="metric-timeline"]')).toBeNull()
  })
})
