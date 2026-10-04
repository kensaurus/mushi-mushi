import { describe, expect, it } from 'vitest'
import { creditsLine, spendLine } from './byokCredits'

describe('creditsLine', () => {
  it('shows what is left of the plan and when it resets', () => {
    expect(
      creditsLine({ kind: 'credits', remaining: 812, unit: 'credits', limit: 1000, used: 188, periodEnd: '2026-10-31T23:59:59Z', source: 's' }),
    ).toEqual({ text: '812 credits left of 1,000 credits, resets Oct 31.', tone: 'ok' })
  })

  it('flags a balance under 10% or used up', () => {
    expect(creditsLine({ kind: 'credits', remaining: 50, unit: 'credits', limit: 1000, used: 950, periodEnd: null, source: 's' }).tone).toBe('low')
    expect(creditsLine({ kind: 'credits', remaining: 0, unit: 'usd', limit: null, used: 10, periodEnd: null, source: 's' }).tone).toBe('low')
  })

  it('says a key has no cap instead of showing $0', () => {
    expect(creditsLine({ kind: 'credits', remaining: null, unit: 'usd', limit: null, used: 3.58, periodEnd: null, source: 's' })).toEqual({
      text: 'No spending cap on this key, $3.58 used.',
      tone: 'ok',
    })
  })

  it('passes through why a provider cannot report, and errors', () => {
    expect(creditsLine({ kind: 'unavailable', reason: 'OpenAI has no API for the remaining balance.' }).tone).toBe('muted')
    expect(creditsLine({ kind: 'error', message: 'Firecrawl answered 401' }).text).toBe('Could not read the balance: Firecrawl answered 401')
  })
})

describe('spendLine', () => {
  it('summarises recorded spend', () => {
    expect(spendLine({ provider: 'anthropic', calls: 43, costUsd: 0.6135, inputTokens: 100000, outputTokens: 2345, byokCalls: 40 })).toBe(
      'Last 30 days: $0.61 across 43 calls (102,345 tokens), 40 on your keys.',
    )
    expect(spendLine(undefined)).toBe('No AI calls recorded through this service in the last 30 days.')
  })
})

describe('spendLine grammar', () => {
  it('says "1 call", not "1 calls"', () => {
    expect(spendLine({ provider: 'openrouter', calls: 1, costUsd: 0, inputTokens: 8, outputTokens: 0, byokCalls: 1 })).toBe(
      'Last 30 days: $0.00 across 1 call (8 tokens), 1 on your keys.',
    )
  })
})
