/**
 * FILE: btn-gradient.test.ts
 * PURPOSE: Keep the primary/accent buttons visible.
 *
 *          `bg-[var(--gradient-brand)]` reads as correct and survives lint,
 *          typecheck, and every design-token check — but Tailwind v4 types the
 *          square-bracket form as a *color*, emitting
 *          `background-color: var(--gradient-brand)`. That is not a valid
 *          color, so the browser drops the declaration and the button paints
 *          nothing: near-white `text-brand-fg` on the bare page, ~1.3:1
 *          contrast. Observed live on the login screen, where the primary
 *          "Sign in" CTA rendered as an empty grey slab.
 *
 *          The documented form for feeding a gradient custom property to a
 *          background utility is `bg-(image:--gradient-brand)`, which compiles
 *          to `background-image`.
 *          https://tailwindcss.com/docs/background-image
 *
 *          The repo-wide sweep lives in scripts/check-gradient-utilities.mjs;
 *          this test pins the two variants that actually regressed.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const FORMS = readFileSync(join(__dirname, 'forms.tsx'), 'utf8')

/** Pull one variant's class string out of the BTN_VARIANTS map. */
function variantClasses(name: string): string {
  const rx = new RegExp(`\\b${name}:\\s*\\n?\\s*'([^']*)'`)
  const m = FORMS.match(rx)
  if (!m) throw new Error(`variant "${name}" not found in BTN_VARIANTS`)
  return m[1]
}

describe('Btn gradient variants', () => {
  for (const [variant, token] of [
    ['primary', '--gradient-brand'],
    ['accent', '--gradient-accent'],
  ] as const) {
    describe(variant, () => {
      const classes = variantClasses(variant)

      it('uses the image-typed custom-property form that actually renders', () => {
        expect(classes).toContain(`bg-(image:${token})`)
      })

      it('never uses the square-bracket form (compiles to background-color, renders nothing)', () => {
        expect(classes).not.toContain(`bg-[var(${token})]`)
      })

      it('keeps a solid background underneath so the label stays legible without the gradient', () => {
        // If the gradient token ever goes missing, `background-image` resolves
        // to nothing and the button falls back to this flat fill rather than
        // to the page background.
        expect(classes).toMatch(/\bbg-(brand|accent)\b/)
      })
    })
  }
})
