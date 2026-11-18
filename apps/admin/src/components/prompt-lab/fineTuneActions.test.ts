import { describe, expect, it } from 'vitest'
import { fineTuneNextActions, opensFineTuning } from './fineTuneActions'

const job = (status: string, passed?: boolean) => ({
  status,
  validation_report: passed == null ? null : { passed, accuracy: 0.9, sampleCount: 10 },
})

describe('fineTuneNextActions', () => {
  it('gives every non-final status a forward action', () => {
    expect(fineTuneNextActions(job('pending')).canExport).toBe(true)
    expect(fineTuneNextActions(job('exported')).canSubmit).toBe(true)
    expect(fineTuneNextActions(job('training')).canPoll).toBe(true)
    expect(fineTuneNextActions(job('trained')).canValidate).toBe(true)
    expect(fineTuneNextActions(job('validated')).canPromote).toBe(true)
  })

  it('does not offer Submit or Check status out of order', () => {
    expect(fineTuneNextActions(job('pending')).canSubmit).toBe(false)
    expect(fineTuneNextActions(job('exported')).canPoll).toBe(false)
  })
})

describe('opensFineTuning (round-2 review 2026-11-18)', () => {
  it('opens the Advanced fine-tuning section for a fine-tuning link only', () => {
    expect(opensFineTuning('fine-tuning')).toBe(true)
    expect(opensFineTuning('advanced')).toBe(true)
    expect(opensFineTuning(null)).toBe(false)
    expect(opensFineTuning('prompts')).toBe(false)
  })
})
