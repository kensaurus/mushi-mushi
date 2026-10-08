// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest'
import { CLS_GOOD, isFrameworkNoise, probePenalty } from './probes.js'

const clean = { axe: [], overflowX: false, smallTargets: 0, consoleErrors: [] as string[], cls: 0 }

describe('isFrameworkNoise', () => {
  it("drops the framework's dev-tool warnings and keeps the app's own errors", () => {
    // Seen on glot.it's /practice and /words (Next 16 segment explorer), 2026-10-06.
    expect(
      isFrameworkNoise(
        'Each child in a list should have a unique "key" prop.%s%s See https://react.dev/link/warning-keys for more information. \n\nCheck the render method of `OuterLayoutRouter`. ',
      ),
    ).toBe(true)
    expect(isFrameworkNoise('[Fast Refresh] rebuilding')).toBe(true)
    // The same warning from an app component is the app's to fix.
    expect(isFrameworkNoise('Each child in a list should have a unique "key" prop.\n\nCheck the render method of `WordList`.')).toBe(false)
    expect(isFrameworkNoise("TypeError: Cannot read properties of undefined (reading 'map')")).toBe(false)
  })
})

describe('probePenalty', () => {
  it('counts layout shift only past the good threshold', () => {
    expect(probePenalty({ ...clean, cls: CLS_GOOD })).toBe(0)
    expect(probePenalty({ ...clean, cls: 0.085 })).toBe(0)
    expect(probePenalty({ ...clean, cls: 0.2 })).toBe(2)
  })
})
