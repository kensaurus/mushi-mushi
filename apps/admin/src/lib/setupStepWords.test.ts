/**
 * FILE: apps/admin/src/lib/setupStepWords.test.ts
 * PURPOSE: The setup checklist in plain words. A test report ticks "first bug
 *          report" before the report button is in the app; the row then says
 *          it was a test, so a tick never sits under "do this next" for the
 *          button (journey walk, 2026-11-28).
 */

import { describe, expect, it } from 'vitest'
import { plainSetupSteps } from './setupStepWords'
import type { SetupStep } from './useSetupStatus'

const step = (id: string, complete: boolean): SetupStep => ({ id, label: id, description: '', complete, required: true, cta_to: '/onboarding', cta_label: 'Go' }) as unknown as SetupStep

describe('plainSetupSteps', () => {
  it('names a first report that came before the button a test report', () => {
    const out = plainSetupSteps([step('sdk_installed', false), step('first_report_received', true)])
    expect(out[1]).toMatchObject({ label: 'Test report received', complete: true })
    expect(out[1]!.description).toContain('Add the report button')
  })

  it('keeps the usual words once the button is in the app', () => {
    const out = plainSetupSteps([step('sdk_installed', true), step('first_report_received', true)])
    expect(out[1]!.label).toBe('Get your first bug report')
  })

  it('keeps the usual words while no report has arrived', () => {
    const out = plainSetupSteps([step('sdk_installed', false), step('first_report_received', false)])
    expect(out[1]!.label).toBe('Get your first bug report')
  })
})
