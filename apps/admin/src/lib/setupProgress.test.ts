import { describe, expect, it } from 'vitest'
import { withSetupRequiredCounts } from './setupProgress'
import type { OnboardingStats } from '../components/onboarding/types'
import { EMPTY_ONBOARDING_STATS } from '../components/onboarding/types'

const step = (id: string, complete: boolean, label = id) => ({ id, label, description: '', complete, required: true, cta_to: '/', cta_label: 'Go' })
const demoSteps = [
  step('project_created', true),
  step('api_key_generated', true),
  step('sdk_installed', false, 'Install the SDK in your app'),
  step('first_report_received', true),
] as never

// What /v1/admin/activation said for mushi-demo: SDK optional, so "ready, 3/3".
const stats: OnboardingStats = {
  ...EMPTY_ONBOARDING_STATS,
  projectId: 'p1',
  hasAnyProject: true,
  requiredComplete: 3,
  requiredTotal: 3,
  setupDone: true,
  nextStepId: null,
  nextStepLabel: null,
}

describe('withSetupRequiredCounts', () => {
  it('takes /v1/admin/setup counts and next step; ready only when both agree (mushi-demo 3/4)', () => {
    const out = withSetupRequiredCounts(stats, { project_id: 'p1', required_complete: 3, required_total: 4, done: false, steps: demoSteps })
    expect(out).toMatchObject({ requiredComplete: 3, requiredTotal: 4, setupDone: false, nextStepId: 'sdk_installed', nextStepLabel: 'Install the SDK in your app' })
  })

  it('keeps the page stats for another project or while setup is loading', () => {
    expect(withSetupRequiredCounts(stats, { project_id: 'p2', required_complete: 1, required_total: 4, done: false, steps: demoSteps })).toBe(stats)
    expect(withSetupRequiredCounts(stats, null)).toBe(stats)
  })

  it('both done reads ready, with no next step', () => {
    const done = [step('project_created', true), step('sdk_installed', true)] as never
    const out = withSetupRequiredCounts(stats, { project_id: 'p1', required_complete: 4, required_total: 4, done: true, steps: done })
    expect(out).toMatchObject({ setupDone: true, nextStepId: null })
  })
})
