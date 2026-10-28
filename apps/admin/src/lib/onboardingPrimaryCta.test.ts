/**
 * FILE: apps/admin/src/lib/onboardingPrimaryCta.test.ts
 * PURPOSE: The pipeline-live card gate matches the "N of N steps" header.
 *
 * The card is the only place the finished-pipeline buttons render, so this
 * module must not grow a second rule (connect agents, or a merged fix while
 * steps remain). Report c016af11.
 */

import { describe, expect, it } from 'vitest'
import * as hero from './onboardingPrimaryCta'

describe('onboardingSetupComplete', () => {
  it('shows the pipeline-live card only when required steps are done and the counter is full', () => {
    expect(hero.onboardingSetupComplete({ done: true, complete: 10, total: 10 })).toBe(true)
    expect(hero.onboardingSetupComplete({ done: true, complete: 8, total: 10 })).toBe(false)
    expect(hero.onboardingSetupComplete({ done: false, complete: 10, total: 10 })).toBe(false)
  })

  it('does not keep a button rule the card cannot reach', () => {
    // The card renders only when this gate is true, so a connect-agents
    // label or a loop-closed branch would be dead. View fixes is written
    // on the page.
    expect(Object.keys(hero).sort()).toEqual(['onboardingSetupComplete'])
  })
})
