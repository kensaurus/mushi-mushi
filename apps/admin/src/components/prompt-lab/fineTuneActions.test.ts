import { describe, expect, it } from 'vitest'
import { fineTuneNextActions } from './fineTuneActions'

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
