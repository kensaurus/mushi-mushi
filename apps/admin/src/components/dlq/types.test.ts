import { describe, expect, it } from 'vitest'
import { STATUS_OPTIONS, queueStageLabel, queueStatusLabel } from './types'

describe('queueStatusLabel', () => {
  it('gives every status lane a human label', () => {
    expect(queueStatusLabel('dead_letter')).toBe('Dead letter')
    expect(queueStatusLabel('failed')).toBe('Failed')
    expect(queueStatusLabel('pending')).toBe('Pending')
    expect(queueStatusLabel('running')).toBe('Running')
    expect(queueStatusLabel('completed')).toBe('Completed')
    for (const lane of STATUS_OPTIONS) {
      expect(queueStatusLabel(lane)).not.toMatch(/_/)
    }
  })

  it('reads unknown lanes as words', () => {
    expect(queueStatusLabel('circuit_open')).toBe('Circuit open')
    expect(queueStatusLabel('')).toBe('')
  })
})

describe('queueStageLabel', () => {
  it('gives known pipeline stages a plain label', () => {
    expect(queueStageLabel('stage1')).toBe('Fast filter')
    expect(queueStageLabel('stage2')).toBe('Classify')
    expect(queueStageLabel('judge')).toBe('Judge')
    expect(queueStageLabel('fix-suggestion')).toBe('Fix suggestion')
  })

  it('reads unknown stages as words', () => {
    expect(queueStageLabel('some_new_stage')).toBe('Some new stage')
  })
})
