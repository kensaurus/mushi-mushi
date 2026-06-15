import { describe, expect, it } from 'vitest'
import {
  buildOnboardingStatsPayload,
} from '../../supabase/functions/api/routes/activation-onboarding-builder.ts'
import {
  deriveActivationPhase,
  resolveNextStepTo,
} from '../../supabase/functions/_shared/activation-status.ts'

describe('activation onboarding builder', () => {
  it('maps next step ids to deep links', () => {
    expect(resolveNextStepTo('sdk_installed')).toBe('/onboarding?tab=sdk')
    expect(resolveNextStepTo('first_qa_story_passing')).toBe('/qa-coverage')
  })

  it('returns ingest phase until setup is done', () => {
    expect(
      deriveActivationPhase({
        setupDone: false,
        reportCount: 0,
        fixCount: 0,
        mergedFixCount: 0,
      }),
    ).toBe('ingest')
  })

  it('emits nextStepTo for incomplete projects', () => {
    const stats = buildOnboardingStatsPayload({
      hasAnyProject: true,
      adminHost: 'localhost:6464',
      project: { id: 'proj', name: 'Demo' },
      signals: {
        hasKey: true,
        hasSdk: false,
        sdkEndpointHost: null,
        sdkHostMismatch: false,
        hasGithub: false,
        hasSentry: false,
        hasByok: false,
        hasQaPassing: false,
        reportCount: 0,
        fixCount: 0,
        mergedFixCount: 0,
      },
    })
    expect(stats.nextStepId).toBe('sdk_installed')
    expect(stats.nextStepTo).toBe('/onboarding?tab=sdk')
  })
})
