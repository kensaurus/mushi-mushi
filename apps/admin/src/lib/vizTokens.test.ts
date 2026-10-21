/**
 * FILE: apps/admin/src/lib/vizTokens.test.ts
 * PURPOSE: readVizToken returns the live stylesheet value and does not
 *          carry a second chart palette. Whether Tailwind emits the viz
 *          tokens at all is guarded by scripts/check-design-tokens.mjs,
 *          which compiles theme-tokens.css; jsdom cannot see that prune.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { extBadgeColor, readVizToken } from './vizTokens'

const UNSTYLED = 'oklch(0.55 0.01 285)'

/** Values the removed per-token fallback map used to return. */
const RETIRED_FALLBACKS: Record<string, string> = {
  'viz-flow-danger': 'oklch(0.63 0.22 25)',
  'viz-lang-javascript': 'oklch(0.86 0.16 95)',
  'viz-neutral': 'oklch(0.55 0.02 285)',
  'viz-node-bg-dark': 'oklch(0.19 0.007 265)',
  'viz-score-ok': 'oklch(0.72 0.19 155)',
}

describe('vizTokens', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('maps file extensions through langVizColor', () => {
    expect(extBadgeColor('tsx')).toBe(readVizToken('viz-lang-react'))
    expect(extBadgeColor('py')).toBe(readVizToken('viz-lang-python'))
    expect(extBadgeColor('unknown-ext')).toBe(readVizToken('viz-lang-default'))
  })

  it('reads the custom property back from the document root', () => {
    const root = document.documentElement
    root.style.setProperty('--color-viz-node-bg-dark', 'oklch(0.41 0.02 20)')
    try {
      expect(readVizToken('viz-node-bg-dark')).toBe('oklch(0.41 0.02 20)')
    } finally {
      root.style.removeProperty('--color-viz-node-bg-dark')
    }
  })

  it('never returns a per-token palette when the stylesheet has no token', () => {
    for (const [name, retired] of Object.entries(RETIRED_FALLBACKS)) {
      document.documentElement.style.removeProperty(`--color-${name}`)
      const value = readVizToken(name)
      expect(value, name).not.toBe(retired)
      expect(value, name).toBe(UNSTYLED)
    }
  })

  it('reports an unset token once in dev', () => {
    vi.stubEnv('DEV', true)
    vi.stubEnv('MODE', 'development')
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    document.documentElement.style.removeProperty('--color-viz-dev-unset-probe')

    readVizToken('viz-dev-unset-probe')
    readVizToken('viz-dev-unset-probe')

    expect(error).toHaveBeenCalledTimes(1)
    expect(String(error.mock.calls[0]?.[0])).toContain('--color-viz-dev-unset-probe')
  })

  it('stays quiet for set tokens, explicit fallbacks, tests and production', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const root = document.documentElement

    vi.stubEnv('DEV', true)
    vi.stubEnv('MODE', 'development')
    root.style.setProperty('--color-viz-dev-set-probe', 'oklch(0.5 0.1 100)')
    try {
      readVizToken('viz-dev-set-probe')
    } finally {
      root.style.removeProperty('--color-viz-dev-set-probe')
    }
    readVizToken('viz-dev-fallback-probe', 'oklch(0.3 0 0)')

    vi.stubEnv('MODE', 'test')
    readVizToken('viz-test-mode-probe')

    vi.stubEnv('DEV', false)
    vi.stubEnv('MODE', 'production')
    readVizToken('viz-prod-probe')

    expect(error).not.toHaveBeenCalled()
  })
})
