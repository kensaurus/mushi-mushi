import { describe, expect, it } from 'vitest'
import { STATUS_OPTIONS, queueStatusLabel } from './types'

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
