/**
 * Set up showed setup progress three times: the rail ("Your app is wired
 * up"), a "Pipeline live · 10 of 10 steps" card saying "the loop runs
 * automatically", and the four-step strip. On glot.it that card sat right
 * under setup gaps saying no fix would start on its own (2026-10-28). The
 * page is too heavy to render here, so the layout is pinned in source.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const src = readFileSync(join(__dirname, 'OnboardingPage.tsx'), 'utf8')

describe('Set up page progress', () => {
  it('has no second "all done" card between the rail and the steps', () => {
    expect(src).not.toContain('Pipeline live')
    expect(src).not.toContain('the loop runs automatically')
  })

  it('keeps the rail, the setup gaps and the steps strip', () => {
    expect(src).toContain('<SetupProgressRail')
    expect(src).toContain('<SetupGapsSection')
    expect(src).toContain('<ProjectNarrativeStrip')
  })
})
