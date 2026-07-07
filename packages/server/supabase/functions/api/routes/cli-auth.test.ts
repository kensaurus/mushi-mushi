import { assertEquals, assertMatch, assertNotEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import type { Context } from 'npm:hono@4'

import { extractClientIp, ipRateLimitActorId } from './cli-auth.ts'

/** Minimal fake Hono Context — only `req.header()` is exercised by extractClientIp. */
function fakeContext(headers: Record<string, string>): Context {
  return {
    req: {
      header: (name: string) => headers[name.toLowerCase()] ?? undefined,
    },
  } as unknown as Context
}

Deno.test('extractClientIp prefers cf-connecting-ip over x-forwarded-for', () => {
  const c = fakeContext({ 'cf-connecting-ip': '1.2.3.4', 'x-forwarded-for': '5.6.7.8' })
  assertEquals(extractClientIp(c), '1.2.3.4')
})

Deno.test('extractClientIp uses the RIGHTMOST x-forwarded-for hop (spoof-resistant)', () => {
  // Each proxy appends the peer it actually saw, so the last entry is the only
  // one the client cannot fabricate. The leftmost entry is fully attacker-
  // controlled and must NOT be used to key the rate limiter.
  const c = fakeContext({ 'x-forwarded-for': '9.8.7.6, 10.0.0.1' })
  assertEquals(extractClientIp(c), '10.0.0.1')
})

Deno.test('extractClientIp ignores a client-spoofed leftmost x-forwarded-for entry', () => {
  // A caller prepending a fake IP to rotate past the per-IP throttle must land
  // in the same bucket as the same caller sending no fake prefix.
  const spoofed = fakeContext({ 'x-forwarded-for': '203.0.113.9, 198.51.100.7' })
  const honest = fakeContext({ 'x-forwarded-for': '198.51.100.7' })
  assertEquals(extractClientIp(spoofed), extractClientIp(honest))
})

Deno.test('extractClientIp trims whitespace and skips empty x-forwarded-for entries', () => {
  const c = fakeContext({ 'x-forwarded-for': ' 9.8.7.6 ,  10.0.0.1 ,' })
  assertEquals(extractClientIp(c), '10.0.0.1')
})

Deno.test('extractClientIp falls back to "unknown" when no IP header is present', () => {
  const c = fakeContext({})
  assertEquals(extractClientIp(c), 'unknown')
})

Deno.test('ipRateLimitActorId is deterministic for the same ip+scope', async () => {
  const a = await ipRateLimitActorId('1.2.3.4', 'cli_device_auth_start')
  const b = await ipRateLimitActorId('1.2.3.4', 'cli_device_auth_start')
  assertEquals(a, b)
})

Deno.test('ipRateLimitActorId differs across scopes for the same ip (bucket isolation)', async () => {
  const start = await ipRateLimitActorId('1.2.3.4', 'cli_device_auth_start')
  const token = await ipRateLimitActorId('1.2.3.4', 'cli_device_auth_token')
  assertNotEquals(start, token)
})

Deno.test('ipRateLimitActorId differs across IPs for the same scope', async () => {
  const a = await ipRateLimitActorId('1.2.3.4', 'cli_device_auth_start')
  const b = await ipRateLimitActorId('4.3.2.1', 'cli_device_auth_start')
  assertNotEquals(a, b)
})

Deno.test('ipRateLimitActorId produces a well-formed 8-4-4-4-12 UUID shape', async () => {
  const id = await ipRateLimitActorId('203.0.113.5', 'cli_device_auth_token')
  assertMatch(id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
})
