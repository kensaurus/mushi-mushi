/**
 * CLI device-auth pure helpers — mirrors cli-auth-helpers.ts.
 * Run: cd packages/server && deno test supabase/functions/_shared/cli-auth-helpers.test.ts
 */

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import {
  TOKEN_REDELIVERY_GRACE_MS,
  evaluateTokenDelivery,
  parseClientId,
} from './cli-auth-helpers.ts'

Deno.test('parseClientId — accepts persisted CLI machine ids', () => {
  assertEquals(parseClientId('cli_abc123def456'), 'cli_abc123def456')
})

Deno.test('parseClientId — rejects too-short or invalid chars', () => {
  assertEquals(parseClientId('short'), null)
  assertEquals(parseClientId('has spaces'), null)
  assertEquals(parseClientId(undefined), null)
})

Deno.test('evaluateTokenDelivery — first claim delivers', () => {
  const decision = evaluateTokenDelivery(
    { cli_token_raw: 'tok', cli_token_claimed_at: null },
    Date.now(),
  )
  assertEquals(decision, { action: 'deliver', firstClaim: true })
})

Deno.test('evaluateTokenDelivery — re-delivers inside grace window', () => {
  const claimedAt = new Date(Date.now() - 30_000).toISOString()
  const decision = evaluateTokenDelivery(
    { cli_token_raw: 'tok', cli_token_claimed_at: claimedAt },
    Date.now(),
  )
  assertEquals(decision, { action: 'deliver', firstClaim: false })
})

Deno.test('evaluateTokenDelivery — invalid_grant after grace window', () => {
  const claimedAt = new Date(Date.now() - TOKEN_REDELIVERY_GRACE_MS - 1).toISOString()
  const decision = evaluateTokenDelivery(
    { cli_token_raw: 'tok', cli_token_claimed_at: claimedAt },
    Date.now(),
  )
  assertEquals(decision, { action: 'invalid_grant', reason: 'grace_elapsed' })
})

Deno.test('evaluateTokenDelivery — invalid_grant when raw token scrubbed', () => {
  const decision = evaluateTokenDelivery(
    { cli_token_raw: null, cli_token_claimed_at: new Date().toISOString() },
    Date.now(),
  )
  assertEquals(decision, { action: 'invalid_grant', reason: 'no_token' })
})
