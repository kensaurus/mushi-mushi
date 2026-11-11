import { describe, expect, it } from 'vitest'
import { modelLine, SAMPLE_EXPLANATION_LABEL } from './reportInternals'

describe('modelLine', () => {
  it('calls the sample report a sample, for everyone', () => {
    expect(modelLine('precomputed', false)).toBe(SAMPLE_EXPLANATION_LABEL)
    expect(modelLine('precomputed', true)).toBe('Sample explanation (written in advance)')
  })

  it('shows a real model name to operator accounts only', () => {
    expect(modelLine('claude-haiku-5-5', true)).toBe('Model: claude-haiku-5-5')
    expect(modelLine('claude-haiku-5-5', false)).toBeNull()
    expect(modelLine(null, true)).toBeNull()
  })
})
