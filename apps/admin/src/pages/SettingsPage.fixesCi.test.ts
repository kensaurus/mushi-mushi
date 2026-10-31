/**
 * Settings General was about 2,600 words on one tab (integrator's new-user
 * walk, 2026-10-28). Pull request review, verified merge, CI cost and CI
 * policy now wait behind one toggle, which opens by itself when a link points
 * at one of them. The page is too heavy to render here, so this is pinned in
 * source.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const src = readFileSync(join(__dirname, 'SettingsPage.tsx'), 'utf8')

describe('Settings General: fixes and CI cards', () => {
  it('renders the four cards only once the toggle is open', () => {
    const gated = src.slice(src.indexOf('{showFixesAndCi && ('))
    expect(gated.length).toBeLessThan(src.length)
    for (const card of ['AgentPrReviewCard', 'VerifiedMergeCard', 'CiCostSettingsCard', 'CiPolicyCard']) {
      expect(src.split(`<${card} `).length - 1, card).toBe(1)
      expect(gated, card).toContain(`<${card} `)
    }
  })

  it('opens the toggle when the link targets one of its sections', () => {
    expect(src).toMatch(/FIXES_AND_CI_ANCHORS[^=]*=\s*\[\s*SETTINGS_SECTION_IDS\.verifiedMerge,\s*SETTINGS_SECTION_IDS\.ciCost,\s*SETTINGS_SECTION_IDS\.ciPolicy,?\s*\]/)
    expect(src).toContain('useState(fixesAndCiLinked)')
  })
})
