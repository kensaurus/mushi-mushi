/**
 * FILE: btn-chip-hover.test.ts
 * PURPOSE: Cancel, danger and success take their resting border from
 *          CHIP_TONE. The hover border colour is separate feedback — cancel
 *          has no glow, only a background shift and this border change.
 *          A resting `border-<tone>/<n>` next to the recipe is still the
 *          redundant border the chip-tone lint rule removes.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const FORMS = readFileSync(join(__dirname, 'forms.tsx'), 'utf8')

function variantTemplate(name: string): string {
  const rx = new RegExp(String.raw`\b${name}:\s*\n?\s*\`([^\`]*)\``)
  const m = FORMS.match(rx)
  if (!m) throw new Error(`variant "${name}" template not found in BTN_VARIANTS`)
  return m[1]
}

const INTERACTION = /^(?:hover|focus|focus-visible|focus-within|active)$/

function restingToneBorders(src: string): string[] {
  return src.split(/\s+/).filter((token) => {
    const parts = token.split(':')
    const utility = parts.pop() ?? ''
    if (!/^border-(?:danger|ok)\/\d+$/.test(utility)) return false
    return !(parts.length > 0 && parts.every((prefix) => INTERACTION.test(prefix)))
  })
}

describe('Btn chip variants keep hover border colour', () => {
  it('cancel, danger and success recolour the recipe border on hover', () => {
    expect(variantTemplate('cancel')).toContain('${CHIP_TONE.danger}')
    expect(variantTemplate('cancel')).toContain('hover:border-danger/50')
    expect(variantTemplate('danger')).toContain('${CHIP_TONE.dangerSubtle}')
    expect(variantTemplate('danger')).toContain('hover:border-danger/40')
    expect(variantTemplate('success')).toContain('${CHIP_TONE.okSubtle}')
    expect(variantTemplate('success')).toContain('hover:border-ok/40')
  })

  it('does not put a second resting tone border on the recipe', () => {
    for (const name of ['cancel', 'danger', 'success'] as const) {
      expect(restingToneBorders(variantTemplate(name)), name).toEqual([])
    }
  })
})
