import { describe, it, expect } from 'vitest'
import { checkForSecrets, buildReviewPrompt, parseReviewResponse } from './review.js'
import type { FixContext } from './types.js'

describe('checkForSecrets', () => {
  it('returns clean for normal code', () => {
    const result = checkForSecrets('const x = 42;\nfunction foo() {}')
    expect(result.clean).toBe(true)
    expect(result.findings).toHaveLength(0)
  })

  it('detects api_key patterns', () => {
    const result = checkForSecrets('api_key = "sk-12345"')
    expect(result.clean).toBe(false)
    expect(result.findings.length).toBeGreaterThan(0)
  })

  it('detects password patterns', () => {
    const result = checkForSecrets('password = "hunter2"')
    expect(result.clean).toBe(false)
  })

  it('detects .env references', () => {
    const result = checkForSecrets('source .env.local')
    expect(result.clean).toBe(false)
  })

  it('detects private_key patterns', () => {
    const result = checkForSecrets('private_key = "-----BEGIN"')
    expect(result.clean).toBe(false)
  })
})

describe('parseReviewResponse', () => {
  it('detects approval', () => {
    const result = parseReviewResponse('I approve this change. It looks correct.')
    expect(result.approved).toBe(true)
  })

  it('detects explicit rejection', () => {
    const result = parseReviewResponse('I reject this change. It misses edge cases.')
    expect(result.approved).toBe(false)
  })

  it('detects "do not approve"', () => {
    const result = parseReviewResponse('I do not approve this change.')
    expect(result.approved).toBe(false)
  })

  it('truncates reasoning to 500 chars', () => {
    const long = 'a'.repeat(1000)
    const result = parseReviewResponse(long)
    expect(result.reasoning.length).toBe(500)
  })
})

describe('buildReviewPrompt', () => {
  const context: FixContext = {
    reportId: 'rpt_123',
    report: {
      summary: 'Button crash on click',
      category: 'bug',
      severity: 'high',
      component: 'Button',
      rootCause: 'Null ref in handler',
      description: 'test',
    },
    reproductionSteps: ['Open page', 'Click button', 'See crash'],
  } as FixContext

  it('includes report details', () => {
    const prompt = buildReviewPrompt(context, '+ fix()')
    expect(prompt).toContain('Button crash on click')
    expect(prompt).toContain('bug')
    expect(prompt).toContain('high')
    expect(prompt).toContain('Null ref in handler')
  })

  it('includes reproduction steps', () => {
    const prompt = buildReviewPrompt(context, '')
    expect(prompt).toContain('1. Open page')
    expect(prompt).toContain('2. Click button')
    expect(prompt).toContain('3. See crash')
  })

  it('includes the diff', () => {
    const prompt = buildReviewPrompt(context, '+ const fixed = true;')
    expect(prompt).toContain('+ const fixed = true;')
  })

  it('truncates long diffs to 5000 chars', () => {
    const longDiff = 'x'.repeat(10000)
    const prompt = buildReviewPrompt(context, longDiff)
    expect(prompt.length).toBeLessThan(10000)
  })
})
