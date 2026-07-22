import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { isTransientDbConnectionError } from './error-codes.ts'

// ── The two real production issues this classifier must catch ─────────────────
// (MUSHI-MUSHI-SERVER-1P / -1M — see sentry.ts precedent for the pattern.)

Deno.test('SERVER-1P: Supabase pooler reset ("delayed connect error: 111") is transient', () => {
  const err = {
    message:
      'upstream connect error or disconnect/reset before headers. retried and the ' +
      'latest reset reason: remote connection failure, transport failure reason: ' +
      'delayed connect error: 111',
    code: null,
  }
  assertEquals(isTransientDbConnectionError(err), true)
})

Deno.test('SERVER-1M: Cloudflare 522 origin-timeout HTML page is transient', () => {
  const err = {
    message:
      '<!DOCTYPE html><title>supabase.co | 522: Connection timed out</title>' +
      '<span class="code-label">Error code 522</span>',
    code: null,
  }
  assertEquals(isTransientDbConnectionError(err), true)
})

// ── Must NOT hide real bugs: genuine coded SQLSTATE errors always report ───────

Deno.test('real DB errors with a SQLSTATE are NOT transient (never silenced)', () => {
  assertEquals(isTransientDbConnectionError({ message: 'column x does not exist', code: '42703' }), false)
  assertEquals(isTransientDbConnectionError({ message: 'permission denied', code: '42501' }), false)
  assertEquals(isTransientDbConnectionError({ message: 'duplicate key', code: '23505' }), false)
  // PL/pgSQL RAISE EXCEPTION carries P0001 — even if its text mentions a network
  // token, the code wins and it is reported (the review's top false-negative risk).
  assertEquals(
    isTransientDbConnectionError({ message: 'RAISE: connection timed out for provider', code: 'P0001' }),
    false,
  )
  // Pool exhaustion / statement timeout are real capacity signals — keep paging.
  assertEquals(isTransientDbConnectionError({ message: 'too many connections', code: '53300' }), false)
  assertEquals(isTransientDbConnectionError({ message: 'canceling statement due to statement timeout', code: '57014' }), false)
})

// ── Genuine connection-family SQLSTATEs ARE transient ─────────────────────────

Deno.test('connection_exception SQLSTATE class 08 (and 57P03) is transient', () => {
  assertEquals(isTransientDbConnectionError({ message: 'connection failure', code: '08006' }), true)
  assertEquals(isTransientDbConnectionError({ message: 'unable to establish', code: '08001' }), true)
  assertEquals(isTransientDbConnectionError({ message: 'cannot connect now', code: '57P03' }), true)
})

// ── False-positive guards from code review ────────────────────────────────────

Deno.test('a bare "522" substring in an unrelated message is NOT transient', () => {
  // e.g. a real validation/constraint error whose text happens to contain 522.
  assertEquals(isTransientDbConnectionError({ message: 'value 5220 exceeds maximum allowed', code: null }), false)
  assertEquals(isTransientDbConnectionError({ message: 'row 522 failed check constraint', code: null }), false)
})

Deno.test('generic "connection refused" (persistent misconfig) is NOT auto-silenced', () => {
  // A dead host / wrong port produces this forever — must remain visible.
  assertEquals(isTransientDbConnectionError({ message: 'connection refused', code: null }), false)
})

// ── Null / shape safety ───────────────────────────────────────────────────────

Deno.test('null / undefined / empty errors are not transient', () => {
  assertEquals(isTransientDbConnectionError(null), false)
  assertEquals(isTransientDbConnectionError(undefined), false)
  assertEquals(isTransientDbConnectionError({}), false)
  assertEquals(isTransientDbConnectionError({ message: undefined, code: undefined }), false)
})
