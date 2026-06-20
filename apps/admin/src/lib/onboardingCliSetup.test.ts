import { describe, expect, it } from 'vitest'
import {
  CLI_SETUP_QUERY,
  cliSetupOnboardingPath,
  isCliSetupMode,
  shouldFocusCreateForm,
  shouldShowOnboardingCreateForm,
} from './onboardingCliSetup'

describe('onboardingCliSetup', () => {
  it('detects setup=cli mode', () => {
    expect(isCliSetupMode('tab=steps&setup=cli')).toBe(true)
    expect(isCliSetupMode(new URLSearchParams({ setup: 'cli' }))).toBe(true)
    expect(isCliSetupMode('tab=steps')).toBe(false)
  })

  it('builds deep link path', () => {
    expect(cliSetupOnboardingPath()).toBe(`/onboarding?tab=steps&${CLI_SETUP_QUERY}`)
  })

  it('focuses create form for cli setup or focus=create', () => {
    expect(shouldFocusCreateForm('setup=cli')).toBe(true)
    expect(shouldFocusCreateForm('focus=create')).toBe(true)
    expect(shouldFocusCreateForm('tab=overview')).toBe(false)
  })

  it('shows create form for CLI setup even when projects exist', () => {
    expect(shouldShowOnboardingCreateForm(true, true, false)).toBe(true)
    expect(shouldShowOnboardingCreateForm(false, true, false)).toBe(false)
    expect(shouldShowOnboardingCreateForm(true, false, false)).toBe(true)
    expect(shouldShowOnboardingCreateForm(true, true, true)).toBe(false)
  })
})
