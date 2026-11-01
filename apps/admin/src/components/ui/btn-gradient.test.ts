/**
 * FILE: btn-gradient.test.ts
 * PURPOSE: Keep the primary button visible — and the only filled one.
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
 *          2026-09-23: the violet `accent` variant was retired. The same Save
 *          rendered vermillion in the Slack card and violet (dark text on
 *          violet, lavender when disabled) in the Discord/Teams cards next to
 *          it. One filled CTA; disabled is a neutral well, never the brand fill
 *          faded to 40% (which read as salmon).
 *
 *          The repo-wide sweep lives in scripts/check-gradient-utilities.mjs.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// The recipe moved to lib/btnRecipe.ts (shared by <Btn> and btnClass()).
const FORMS = readFileSync(join(__dirname, '../../lib/btnRecipe.ts'), 'utf8')

/** Pull one variant's class string (all concatenated literals) out of BTN_VARIANTS. */
function variantClasses(name: string): string {
  const rx = new RegExp(`\\n\\s*${name}:\\s*\\n?((?:\\s*'[^']*'\\s*\\+?)+)`)
  const m = FORMS.match(rx)
  if (!m) throw new Error(`variant "${name}" not found in BTN_VARIANTS`)
  return [...m[1].matchAll(/'([^']*)'/g)].map((x) => x[1]).join('')
}

describe('Btn primary variant', () => {
  const classes = variantClasses('primary')

  it('uses the image-typed custom-property form that actually renders', () => {
    expect(classes).toContain('bg-(image:--gradient-brand)')
  })

  it('never uses the square-bracket form (compiles to background-color, renders nothing)', () => {
    expect(classes).not.toContain('bg-[var(--gradient-brand)]')
  })

  it('keeps a solid background underneath so the label stays legible without the gradient', () => {
    expect(classes).toMatch(/(^|\s)bg-brand(\s|$)/)
  })

  it('renders disabled as a neutral well instead of fading the brand fill', () => {
    expect(classes).toContain('disabled:bg-surface-overlay')
    expect(classes).toContain('disabled:bg-none')
    expect(classes).not.toMatch(/disabled:opacity-\d/)
    // Keeps its outline when disabled; the always-on transparent border
    // means the disabled edge causes no layout shift.
    expect(classes).toContain('border-transparent')
    expect(classes).toContain('disabled:border-edge-subtle')
  })
})

describe('Btn variant set', () => {
  it('has exactly one filled CTA variant (no second filled hue)', () => {
    expect(FORMS).not.toMatch(/\n\s*accent:\s*\n?\s*'/)
    expect(FORMS).not.toMatch(/BtnVariant =[^\n]*'accent'/)
  })

  it('does not put a blanket disabled opacity on the shared base', () => {
    const base = FORMS.match(/const BTN_BASE =([\s\S]*?)\n\n/)?.[1] ?? ''
    expect(base).not.toMatch(/disabled:opacity-/)
  })
})
