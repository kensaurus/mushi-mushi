import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

// Retry tests set a 1ms base backoff so the suite stays fast; the module
// reads env at import time so this must happen before the dynamic import
// below.
Deno.env.set('MUSHI_LLM_TRANSIENT_BASE_BACKOFF_MS', '1')
Deno.env.set('MUSHI_LLM_TRANSIENT_MAX_RETRIES', '2')
const { classifyLlmError, callWithTransientRetry } = await import('./llm-failover.ts')

import type { ResolvedKey } from './byok.ts'

const candidate: ResolvedKey = {
  keyId: 'key-1',
  key: 'sk-test',
  source: 'byok',
  hint: 'test',
}

Deno.test('classifyLlmError detects quota errors from message text', () => {
  assertEquals(classifyLlmError(new Error('429 Too Many Requests')), 'quota')
  assertEquals(classifyLlmError(new Error('You exceeded your current quota')), 'quota')
})

Deno.test('classifyLlmError detects auth errors from message text', () => {
  assertEquals(classifyLlmError(new Error('401 Unauthorized')), 'auth')
  assertEquals(classifyLlmError(new Error('Invalid API Key provided')), 'auth')
})

Deno.test('classifyLlmError detects quota/auth from structured status codes', () => {
  assertEquals(classifyLlmError({ status: 429 }), 'quota')
  assertEquals(classifyLlmError({ statusCode: 403 }), 'auth')
  assertEquals(classifyLlmError({ response: { status: 401 } }), 'auth')
})

Deno.test('classifyLlmError detects transient 5xx and network errors', () => {
  assertEquals(classifyLlmError({ status: 503 }), 'transient')
  assertEquals(classifyLlmError(new Error('fetch failed')), 'transient')
  assertEquals(classifyLlmError(new Error('socket hang up')), 'transient')
  assertEquals(classifyLlmError({ code: 'ECONNRESET' }), 'transient')
  assertEquals(classifyLlmError(new Error('model is overloaded, please retry')), 'transient')
  assertEquals(classifyLlmError(new Error('Bad Gateway 502')), 'transient')
})

Deno.test('classifyLlmError falls back to other for schema/validation errors', () => {
  assertEquals(classifyLlmError(new Error('No object generated: response did not match schema')), 'other')
})

Deno.test('callWithTransientRetry succeeds without retry on first try', async () => {
  let calls = 0
  const outcome = await callWithTransientRetry(
    async (key) => {
      calls++
      return `ok:${key.hint}`
    },
    candidate,
    'anthropic',
  )
  assertEquals(calls, 1)
  assertEquals(outcome, { ok: true, result: 'ok:test' })
})

Deno.test('callWithTransientRetry retries a transient error on the same key then succeeds', async () => {
  let calls = 0
  const outcome = await callWithTransientRetry(
    async () => {
      calls++
      if (calls < 2) throw new Error('503 Service Unavailable')
      return 'recovered'
    },
    candidate,
    'anthropic',
  )
  assertEquals(calls, 2)
  assertEquals(outcome, { ok: true, result: 'recovered' })
})

Deno.test('callWithTransientRetry exhausts retries and returns transient_exhausted (no key marking)', async () => {
  let calls = 0
  const outcome = await callWithTransientRetry(
    async () => {
      calls++
      throw new Error('504 Gateway Timeout')
    },
    candidate,
    'anthropic',
  )
  // MUSHI_LLM_TRANSIENT_MAX_RETRIES=2 → 1 initial attempt + 2 retries = 3 calls.
  assertEquals(calls, 3)
  if (outcome.ok) throw new Error('expected failure outcome')
  assertEquals(outcome.kind, 'transient_exhausted')
})

Deno.test('callWithTransientRetry surfaces quota errors immediately without retrying', async () => {
  let calls = 0
  const outcome = await callWithTransientRetry(
    async () => {
      calls++
      throw new Error('429 rate limit exceeded')
    },
    candidate,
    'anthropic',
  )
  assertEquals(calls, 1)
  if (outcome.ok) throw new Error('expected failure outcome')
  assertEquals(outcome.kind, 'quota')
})

Deno.test('callWithTransientRetry surfaces auth errors immediately without retrying', async () => {
  let calls = 0
  const outcome = await callWithTransientRetry(
    async () => {
      calls++
      throw new Error('401 unauthorized')
    },
    candidate,
    'anthropic',
  )
  assertEquals(calls, 1)
  if (outcome.ok) throw new Error('expected failure outcome')
  assertEquals(outcome.kind, 'auth')
})

Deno.test('callWithTransientRetry returns fatal with original error preserved for non-key errors', async () => {
  class CustomSchemaError extends Error {
    marker = 'custom' as const
  }
  let calls = 0
  const original = new CustomSchemaError('schema validation failed')
  const outcome = await callWithTransientRetry(
    async () => {
      calls++
      throw original
    },
    candidate,
    'anthropic',
  )
  assertEquals(calls, 1)
  if (outcome.ok) throw new Error('expected failure outcome')
  assertEquals(outcome.kind, 'fatal')
  if (outcome.kind === 'fatal') {
    assertEquals(outcome.error, original)
    assertEquals((outcome.error as CustomSchemaError).marker, 'custom')
  }
})
