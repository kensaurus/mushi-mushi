import { describe, expect, it } from 'vitest'
import {
  GUIDE_PANEL_SHELL_DEFAULT,
  GUIDE_PANEL_SHELL_INSET,
  GUIDE_STAGE_ROW_NEUTRAL,
} from './guideSurfaces'

describe('guideSurfaces', () => {
  it('uses opaque surfaces — no transparent or alpha-mixed page bleed', () => {
    const classes = [GUIDE_PANEL_SHELL_DEFAULT, GUIDE_PANEL_SHELL_INSET, GUIDE_STAGE_ROW_NEUTRAL]
    for (const cls of classes) {
      expect(cls).not.toMatch(/bg-transparent/)
      expect(cls).not.toMatch(/surface-(overlay|raised)\/\d+/)
    }
  })

  it('default panel is an opaque panel surface', () => {
    expect(GUIDE_PANEL_SHELL_DEFAULT).toContain('bg-panel')
  })

  it('inset panel adds a hairline only — no second (grey) surface inside a card', () => {
    expect(GUIDE_PANEL_SHELL_INSET).not.toMatch(/\bbg-/)
    expect(GUIDE_STAGE_ROW_NEUTRAL).not.toMatch(/\bbg-/)
  })

  it('does not borrow the ok (success) hue for help chrome', () => {
    for (const cls of [GUIDE_PANEL_SHELL_DEFAULT, GUIDE_PANEL_SHELL_INSET]) {
      expect(cls).not.toMatch(/\b(border|bg)-ok\b/)
    }
  })
})
