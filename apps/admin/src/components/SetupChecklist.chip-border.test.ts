/**
 * FILE: SetupChecklist.chip-border.test.ts
 * PURPOSE: The collapsed setup chip paints CHIP_TONE.okSubtle / warnSubtle,
 *          which already include `border` (1px) plus the tone colour. A bare
 *          `border` in the static class string is a second width utility on
 *          top of that recipe.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CHIP_TONE } from '../lib/chipTone'

const SOURCE = readFileSync(join(__dirname, 'SetupChecklist.tsx'), 'utf8')

function collapsedBannerStaticClasses(source: string): string {
  const m = source.match(
    /className=\{`([^`$]*)\$\{[\s\S]*?CHIP_TONE\.okSubtle[\s\S]*?CHIP_TONE\.warnSubtle[\s\S]*?\}([^`$]*)`\}/,
  )
  if (!m) throw new Error('collapsed setup chip className not found')
  return `${m[1]} ${m[2]}`
}

describe('collapsed setup checklist chip', () => {
  it('does not stack a bare border on a recipe that already has one', () => {
    for (const tone of [CHIP_TONE.okSubtle, CHIP_TONE.warnSubtle]) {
      expect(tone.split(/\s+/)).toContain('border')
    }
    const tokens = collapsedBannerStaticClasses(SOURCE).split(/\s+/).filter(Boolean)
    expect(tokens).not.toContain('border')
    expect(tokens.join(' ')).not.toMatch(/\bborder-(?:ok|warn)\//)
  })
})
