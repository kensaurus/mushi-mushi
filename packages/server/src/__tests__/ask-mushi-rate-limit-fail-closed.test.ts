/**
 * FILE: packages/server/src/__tests__/ask-mushi-rate-limit-fail-closed.test.ts
 * PURPOSE: Ask Mushi's hourly cap fails closed (owner decision 2026-10-10).
 *          Every call spends LLM money, so when scoped_rate_limit_claim itself
 *          errors (not a quota hit) the route answers 503
 *          RATE_LIMIT_UNAVAILABLE instead of letting the call through
 *          unthrottled — the same rule as repo-digest's claimDigestBuild.
 *          Source-level guard: the limiter is a closure inside
 *          registerAskMushiRoutes, whose module pulls npm: AI SDK imports.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const src = readFileSync(resolve(__dirname, '../../supabase/functions/api/routes/ask-mushi.ts'), 'utf8')

function limiterBody(): string {
  const start = src.indexOf('async function claimAskMushiRateLimit(')
  expect(start).toBeGreaterThan(0)
  const end = src.indexOf('\n  async function ', start + 1)
  return src.slice(start, end)
}

describe('Ask Mushi rate limit', () => {
  it('returns null (proceed) only when the claim succeeded', () => {
    const body = limiterBody()
    expect(body).toContain('if (!rateErr) return null;')
    expect(body.match(/return null;/g)).toHaveLength(1)
  })

  it('answers 429 on a quota hit and 503 RATE_LIMIT_UNAVAILABLE on an RPC failure', () => {
    const body = limiterBody()
    expect(body).toContain("code: 'RATE_LIMITED'")
    expect(body).toContain('status: 429')
    expect(body).toContain("code: 'RATE_LIMIT_UNAVAILABLE'")
    expect(body).toContain('status: 503')
  })

  it('both the single-shot and streaming endpoints go through it', () => {
    expect(src.match(/await claimAskMushiRateLimit\(/g)?.length ?? 0).toBeGreaterThanOrEqual(2)
  })
})
