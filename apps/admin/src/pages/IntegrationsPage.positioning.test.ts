/**
 * Integrations told a new user to "Connect all three to close the full loop",
 * with Mushi's own Langfuse as one of the three, in "Stage 1 classify, Stage 2
 * vision, fix-worker" words. Our positioning says no monitoring stack is
 * required (AGENTS.md). GitHub leads; Sentry is optional; Langfuse is folded
 * under Advanced (integrator's new-user walk, 2026-10-28). The page is too
 * heavy to render here, so the layout is pinned in source.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PLATFORM_DEFS } from '../components/integrations/types'

const src = readFileSync(join(__dirname, 'IntegrationsPage.tsx'), 'utf8')

describe('Integrations positioning', () => {
  it('does not ask for all three, and says GitHub is the one that matters', () => {
    expect(src).not.toContain('Connect all three')
    expect(src).toContain('GitHub is the one Mushi needs')
  })

  // The page led with Sentry and Langfuse; a solo builder needs GitHub, an
  // alert channel and their editor first (first-time user test, 2026-10-28).
  it('leads with GitHub, then alerts and the fix agent, with monitoring last and optional', () => {
    const order = ['>Your code<', '>Alerts<', '>Fix agent<', '>Issue trackers<', '>Errors you already catch (optional)<'].map((label) => src.indexOf(label))
    expect(order.every((i) => i > 0)).toBe(true)
    expect([...order].sort((x, y) => x - y)).toEqual(order)
    expect(src).toContain("d.group === 'required' && d.kind === 'github'")
    expect(src).toContain("d.group === 'required' && d.kind !== 'github'")
    expect(src).toContain('Mushi works without a monitoring tool')
    expect(src).not.toContain('Your code and errors')
  })

  it('folds Langfuse under Advanced, with GitHub and Sentry as the two main cards', () => {
    expect(PLATFORM_DEFS.find((d) => d.kind === 'langfuse')?.group).toBe('advanced')
    expect(PLATFORM_DEFS.filter((d) => d.group === 'required').map((d) => d.kind).sort()).toEqual(['github', 'sentry'])
    expect(src).toContain("d.group === 'advanced'")
  })

  it('describes the cards without pipeline internals', () => {
    for (const def of PLATFORM_DEFS) {
      expect(def.whyItMatters, def.kind).not.toMatch(/fix-worker|Stage [12]|Auto-Fix Pipeline|dispatchable|dispatches|triage required/)
      for (const line of def.capabilitiesOnceConnected ?? []) {
        if (def.kind === 'sentry') expect(line, def.kind).not.toMatch(/report queue|classifier prompt|deduped|triaged/)
      }
    }
  })
})
