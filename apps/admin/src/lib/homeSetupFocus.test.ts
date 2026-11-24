import { describe, expect, it } from 'vitest'
import { isSdkSetupHref, needsYouWithoutSetupStep } from './homeSetupFocus'

// 2026-11-24: a new app's Home repeated the setup checklist's report-button step
// in Needs you and on two health lights.
describe('home setup focus', () => {
  it('recognises the report-button install links', () => {
    expect(isSdkSetupHref('/connect?project=p1#connect-sdk-health')).toBe(true)
    expect(isSdkSetupHref('/connect#connect-sdk')).toBe(true)
    expect(isSdkSetupHref('/onboarding?tab=sdk')).toBe(true)
    expect(isSdkSetupHref('/onboarding?tab=sdk&project=p1')).toBe(true)
    expect(isSdkSetupHref('/onboarding?tab=sdkx')).toBe(false)
    expect(isSdkSetupHref('/connect#connect-github')).toBe(false)
    expect(isSdkSetupHref(null)).toBe(false)
  })

  it('drops only the setup duplicate from Needs you', () => {
    const section = {
      status: 'ok' as const,
      connect: null,
      error: null,
      data: [
        { id: 'sdk_silent', impact: 65, text: 'Your app is not sending to Mushi yet.', action: { label: 'Set up the SDK', to: '/connect?project=p1#connect-sdk-health' } },
        { id: 'critical_open', impact: 90, text: '1 critical bug is waiting for a fix.', action: { label: 'Open', to: '/reports?severity=critical' } },
      ],
    }
    expect(needsYouWithoutSetupStep(section as never).data?.map((i) => i.id)).toEqual(['critical_open'])
  })
})
