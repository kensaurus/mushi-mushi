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

  it('default panel is raised; inset panel is page surface', () => {
    expect(GUIDE_PANEL_SHELL_DEFAULT).toContain('bg-surface-raised')
    expect(GUIDE_PANEL_SHELL_INSET).toContain('bg-surface')
    expect(GUIDE_PANEL_SHELL_INSET).not.toContain('bg-surface-raised')
  })
})
